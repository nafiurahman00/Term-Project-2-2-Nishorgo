-- =============================================================================
-- Nishorgo 2.0 · 05 · Commerce
-- Coupons, orders, order items, status history, Stripe event log, and the
-- order state machine. All money is BDT, numeric(10,2).
-- =============================================================================

create table public.coupons (
  id              bigint generated always as identity primary key,
  code            extensions.citext not null unique check (code ~ '^[A-Za-z0-9_-]{3,24}$'),
  description     text,
  kind            public.discount_kind not null,
  value           numeric(10,2) not null check (value > 0),
  min_subtotal    numeric(10,2) not null default 0,
  max_discount    numeric(10,2),
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz,
  usage_limit     integer check (usage_limit > 0),
  per_user_limit  integer not null default 1 check (per_user_limit > 0),
  times_used      integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100),
  check (ends_at is null or ends_at > starts_at)
);

create sequence public.order_number_seq start 1001;

create table public.orders (
  id                          uuid primary key default gen_random_uuid(),
  order_number                text not null unique,
  user_id                     uuid not null references public.profiles (id) on delete restrict,
  status                      public.order_status not null default 'pending_payment',
  subtotal                    numeric(10,2) not null check (subtotal >= 0),
  discount                    numeric(10,2) not null default 0 check (discount >= 0),
  points_redeemed             integer not null default 0 check (points_redeemed >= 0),
  shipping_fee                numeric(10,2) not null default 0 check (shipping_fee >= 0),
  total                       numeric(10,2) not null check (total >= 0),
  points_earned               integer not null default 0,
  coupon_id                   bigint references public.coupons (id) on delete set null,
  shipping_address            jsonb not null,
  notes                       text check (char_length(notes) <= 500),
  stripe_checkout_session_id  text unique,
  stripe_payment_intent_id    text unique,
  tracking_code               text,
  expires_at                  timestamptz,
  placed_at                   timestamptz not null default now(),
  paid_at                     timestamptz,
  shipped_at                  timestamptz,
  delivered_at                timestamptz,
  cancelled_at                timestamptz,
  updated_at                  timestamptz not null default now(),
  check (total = subtotal - discount - points_redeemed + shipping_fee)
);
create index orders_user_idx    on public.orders (user_id, placed_at desc);
create index orders_status_idx  on public.orders (status, placed_at desc);
create index orders_expiry_idx  on public.orders (expires_at) where status = 'pending_payment';

create table public.order_items (
  id            bigint generated always as identity primary key,
  order_id      uuid not null references public.orders (id) on delete cascade,
  product_id    bigint references public.products (id) on delete set null,
  product_name  text not null,       -- snapshot: survives product edits/deletes
  product_image text,
  unit_price    numeric(10,2) not null check (unit_price > 0),
  quantity      integer not null check (quantity > 0),
  line_total    numeric(10,2) generated always as (unit_price * quantity) stored
);
create index order_items_order_idx   on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);

create table public.order_status_history (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references public.orders (id) on delete cascade,
  from_status  public.order_status,
  to_status    public.order_status not null,
  note         text,
  changed_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index order_status_history_order_idx on public.order_status_history (order_id, created_at);

create table public.coupon_redemptions (
  coupon_id   bigint not null references public.coupons (id) on delete cascade,
  order_id    uuid not null references public.orders (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  amount      numeric(10,2) not null,
  created_at  timestamptz not null default now(),
  primary key (coupon_id, order_id)
);
create index coupon_redemptions_user_idx on public.coupon_redemptions (coupon_id, user_id);

-- Idempotency log for Stripe webhooks: a replayed event is a no-op.
create table public.stripe_events (
  id            text primary key,
  type          text not null,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text
);

-- Late-bound FKs from earlier ledgers.
alter table public.inventory_movements
  add constraint inventory_movements_order_fk foreign key (order_id) references public.orders (id) on delete set null;
alter table public.loyalty_ledger
  add constraint loyalty_ledger_order_fk foreign key (order_id) references public.orders (id) on delete set null;

create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Pricing rules (single source of truth, also used by checkout preview)
-- -----------------------------------------------------------------------------
create or replace function public.shipping_fee_for(p_subtotal numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_subtotal >= 1500 then 0::numeric else 60::numeric end;
$$;

-- Points: 1 Leaf Point = ৳1. At most 20% of the subtotal can be paid in points.
create or replace function public.max_redeemable_points(p_subtotal numeric, p_balance integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(0, least(p_balance, floor(p_subtotal * 0.20)::integer));
$$;

-- Earn rate: 1 point per ৳10 paid, multiplied by tier.
create or replace function public.points_for_order(p_total numeric, p_lifetime_points integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select floor(p_total / 10 * case public.loyalty_tier(p_lifetime_points)
                                when 'Evergreen' then 1.5
                                when 'Bloom'     then 1.25
                                when 'Sprout'    then 1.1
                                else 1.0 end)::integer;
$$;

-- -----------------------------------------------------------------------------
-- Order numbering
-- -----------------------------------------------------------------------------
create or replace function private.assign_order_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.order_number := 'NSG-' || to_char(now() at time zone 'Asia/Dhaka', 'YYMM') || '-'
                      || lpad(nextval('public.order_number_seq')::text, 5, '0');
  return new;
end;
$$;

create trigger orders_assign_number
  before insert on public.orders
  for each row execute function private.assign_order_number();

-- -----------------------------------------------------------------------------
-- Order state machine
-- -----------------------------------------------------------------------------
create or replace function public.order_transition_allowed(p_from public.order_status, p_to public.order_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('pending_payment'::public.order_status, 'paid'::public.order_status),
    ('pending_payment', 'cancelled'),
    ('paid',            'processing'),
    ('paid',            'cancelled'),
    ('paid',            'refunded'),
    ('processing',      'shipped'),
    ('processing',      'cancelled'),
    ('processing',      'refunded'),
    ('shipped',         'delivered'),
    ('delivered',       'refunded')
  );
$$;

create or replace function private.orders_validate_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if not public.order_transition_allowed(old.status, new.status) then
    raise exception 'Order cannot move from % to %', old.status, new.status
      using errcode = 'P0001', hint = 'invalid_transition';
  end if;

  case new.status
    when 'paid'      then new.paid_at := coalesce(new.paid_at, now()); new.expires_at := null;
    when 'shipped'   then new.shipped_at := now();
    when 'delivered' then new.delivered_at := now();
    when 'cancelled' then new.cancelled_at := now(); new.expires_at := null;
    else null;
  end case;
  return new;
end;
$$;

create trigger orders_validate_transition
  before update of status on public.orders
  for each row execute function private.orders_validate_transition();

-- Side effects of status changes. A note can be attached to the history entry
-- with: select set_config('nishorgo.status_note', 'text', true);
create or replace function private.orders_after_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note      text := nullif(current_setting('nishorgo.status_note', true), '');
  v_from      public.order_status := case when tg_op = 'UPDATE' then old.status end;
  v_lifetime  integer;
  v_earned    integer;
  v_balance   integer;
  v_was_paid  boolean := tg_op = 'UPDATE' and old.status in ('paid', 'processing', 'shipped', 'delivered');
  v_link      text := '/orders/' || new.id;
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (new.id, v_from, new.status, v_note, auth.uid());
  -- The note applies to this one transition only.
  perform set_config('nishorgo.status_note', '', true);

  case new.status
    when 'paid' then
      update public.products p
         set sold_count = p.sold_count + oi.quantity
        from public.order_items oi
       where oi.order_id = new.id and oi.product_id = p.id;
      perform private.notify(new.user_id, 'order', 'Payment received 🎉',
        format('Order %s is confirmed. We''re preparing your plants.', new.order_number), v_link);
      perform private.notify_staff('admin', 'New paid order',
        format('%s · ৳%s', new.order_number, new.total), '/admin/orders?focus=' || new.id);

    when 'processing' then
      perform private.notify(new.user_id, 'order', 'Your plants are being packed 📦',
        format('Order %s is being prepared.', new.order_number), v_link);

    when 'shipped' then
      perform private.notify(new.user_id, 'order', 'On the way 🚚',
        format('Order %s has shipped%s.', new.order_number,
               coalesce(' · tracking ' || new.tracking_code, '')), v_link);

    when 'delivered' then
      select lifetime_points into v_lifetime from public.profiles where id = new.user_id;
      v_earned := public.points_for_order(new.total, v_lifetime);
      if v_earned > 0 then
        update public.orders set points_earned = v_earned where id = new.id;
        insert into public.loyalty_ledger (user_id, delta, reason, order_id, note)
        values (new.user_id, v_earned, 'order_earned', new.id,
                format('Earned on order %s', new.order_number));
      end if;
      perform private.notify(new.user_id, 'order', 'Delivered 🌿',
        format('Order %s arrived. Your plants were added to My Garden — leave a review to earn 20 bonus points!', new.order_number),
        '/garden');

    when 'cancelled', 'refunded' then
      -- Return stock only if the plants never left the nursery.
      if v_from in ('pending_payment', 'paid', 'processing') then
        insert into public.inventory_movements (product_id, delta, reason, order_id, note)
        select oi.product_id, oi.quantity, 'cancellation', new.id, 'Order ' || new.order_number || ' ' || new.status
          from public.order_items oi
         where oi.order_id = new.id and oi.product_id is not null;
      end if;

      if v_was_paid then
        update public.products p
           set sold_count = greatest(p.sold_count - oi.quantity, 0)
          from public.order_items oi
         where oi.order_id = new.id and oi.product_id = p.id;
      end if;

      -- Give back redeemed points.
      if new.points_redeemed > 0 then
        insert into public.loyalty_ledger (user_id, delta, reason, order_id, note)
        values (new.user_id, new.points_redeemed, 'redemption_refund', new.id,
                'Points returned from ' || new.order_number);
      end if;

      -- Claw back points earned on delivery (never below zero).
      if new.points_earned > 0 then
        select loyalty_points into v_balance from public.profiles where id = new.user_id;
        if least(new.points_earned, v_balance) > 0 then
          insert into public.loyalty_ledger (user_id, delta, reason, order_id, note)
          values (new.user_id, -least(new.points_earned, v_balance), 'earned_reversal', new.id,
                  'Reversal for refunded ' || new.order_number);
        end if;
      end if;

      -- Release the coupon usage.
      delete from public.coupon_redemptions where order_id = new.id;

      perform private.notify(new.user_id, 'order',
        case new.status when 'cancelled' then 'Order cancelled' else 'Order refunded' end,
        format('Order %s was %s.%s', new.order_number, new.status, coalesce(' ' || v_note, '')), v_link);

    else
      null;
  end case;

  return new;
end;
$$;

create trigger orders_after_status
  after insert or update of status on public.orders
  for each row execute function private.orders_after_status();

-- Keep coupons.times_used in sync with redemptions.
create or replace function private.coupon_usage_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.coupons set times_used = times_used + 1 where id = new.coupon_id;
    return new;
  else
    update public.coupons set times_used = greatest(times_used - 1, 0) where id = old.coupon_id;
    return old;
  end if;
end;
$$;

create trigger coupon_redemptions_counter
  after insert or delete on public.coupon_redemptions
  for each row execute function private.coupon_usage_counter();
