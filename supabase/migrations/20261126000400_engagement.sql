-- =============================================================================
-- Nishorgo 2.0 · 04 · Engagement
-- Notifications (realtime), loyalty points ledger, wishlist, cart, and the
-- auth.users signup trigger.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------
create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        public.notification_kind not null,
  title       text not null,
  body        text,
  link        text,
  data        jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- Internal: single entry point for creating notifications.
create or replace function private.notify(
  p_user uuid, p_kind public.notification_kind, p_title text,
  p_body text default null, p_link text default null, p_data jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link, data)
  values (p_user, p_kind, p_title, p_body, p_link, coalesce(p_data, '{}'::jsonb));
$$;

-- Internal: fan out to every staff/admin account.
create or replace function private.notify_staff(
  p_kind public.notification_kind, p_title text, p_body text default null,
  p_link text default null, p_data jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link, data)
  select p.id, p_kind, p_title, p_body, p_link, coalesce(p_data, '{}'::jsonb)
    from public.profiles p
   where p.role in ('staff', 'admin');
$$;

-- -----------------------------------------------------------------------------
-- Loyalty points ledger  (profiles.loyalty_points = sum(delta))
-- -----------------------------------------------------------------------------
create table public.loyalty_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  delta       integer not null check (delta <> 0),
  reason      public.loyalty_reason not null,
  order_id    uuid,          -- FK added in the orders migration
  note        text,
  created_at  timestamptz not null default now()
);
create index loyalty_ledger_user_idx on public.loyalty_ledger (user_id, created_at desc);

create or replace function private.apply_loyalty_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set loyalty_points  = loyalty_points + new.delta,
         -- Lifetime points (which drive tiers) count everything earned, minus
         -- reversals of earnings; redemptions and their refunds don't affect it.
         lifetime_points = greatest(0, lifetime_points + case
                             when new.reason in ('order_redeemed', 'redemption_refund') then 0
                             else new.delta end)
   where id = new.user_id;

  if new.delta > 0 and new.reason in ('order_earned', 'review_bonus', 'signup_bonus', 'admin_adjustment') then
    perform private.notify(new.user_id, 'loyalty',
      format('+%s Leaf Points', new.delta),
      coalesce(new.note, 'Points added to your balance'),
      '/account?tab=rewards');
  end if;
  return new;
exception
  when check_violation then
    raise exception 'Not enough Leaf Points' using errcode = 'P0001', hint = 'insufficient_points';
end;
$$;

create trigger loyalty_ledger_apply
  after insert on public.loyalty_ledger
  for each row execute function private.apply_loyalty_entry();

create trigger loyalty_ledger_append_only
  before update or delete on public.loyalty_ledger
  for each row execute function private.forbid_mutation();

-- Loyalty tier is derived from lifetime points.
create or replace function public.loyalty_tier(p_lifetime_points integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_lifetime_points >= 5000 then 'Evergreen'
           when p_lifetime_points >= 2000 then 'Bloom'
           when p_lifetime_points >= 500  then 'Sprout'
           else 'Seedling'
         end;
$$;

-- -----------------------------------------------------------------------------
-- Wishlist
-- -----------------------------------------------------------------------------
create table public.wishlist_items (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  product_id  bigint not null references public.products (id) on delete cascade,
  -- Remember the price at the time of wishlisting for price-drop alerts.
  price_when_added numeric(10,2),
  created_at  timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index wishlist_items_product_idx on public.wishlist_items (product_id);

create or replace function private.wishlist_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.products set wishlist_count = wishlist_count + 1 where id = new.product_id;
    return new;
  else
    update public.products set wishlist_count = greatest(wishlist_count - 1, 0) where id = old.product_id;
    return old;
  end if;
end;
$$;

create trigger wishlist_items_counter
  after insert or delete on public.wishlist_items
  for each row execute function private.wishlist_counter();

create or replace function private.wishlist_capture_price()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select price into new.price_when_added from public.products where id = new.product_id;
  return new;
end;
$$;

create trigger wishlist_items_capture_price
  before insert on public.wishlist_items
  for each row execute function private.wishlist_capture_price();

-- -----------------------------------------------------------------------------
-- Cart  (adding to cart no longer touches stock — stock is only committed at checkout)
-- -----------------------------------------------------------------------------
create table public.cart_items (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  product_id  bigint not null references public.products (id) on delete cascade,
  quantity    integer not null check (quantity between 1 and 99),
  added_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, product_id)
);

create trigger cart_items_touch_updated_at
  before update on public.cart_items
  for each row execute function private.touch_updated_at();

-- Validates the product is purchasable and the requested quantity is available.
create or replace function private.validate_cart_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
begin
  select * into v_product from public.products where id = new.product_id;
  if not found or not v_product.is_active then
    raise exception 'This plant is no longer available' using errcode = 'P0001', hint = 'unavailable';
  end if;
  if new.quantity > v_product.stock then
    raise exception 'Only % of "%" left in stock', v_product.stock, v_product.name
      using errcode = 'P0001', hint = 'out_of_stock';
  end if;
  return new;
end;
$$;

create trigger cart_items_validate
  before insert or update of quantity on public.cart_items
  for each row execute function private.validate_cart_item();

-- -----------------------------------------------------------------------------
-- Signup: create profile, award welcome points, send welcome notification.
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := coalesce(new.raw_user_meta_data ->> 'full_name',
                          new.raw_user_meta_data ->> 'name',
                          split_part(new.email, '@', 1));
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email, v_name, new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;

  insert into public.loyalty_ledger (user_id, delta, reason, note)
  values (new.id, 100, 'signup_bonus', 'Welcome to Nishorgo! Here are 100 Leaf Points.');

  perform private.notify(new.id, 'system', 'Welcome to Nishorgo 🌱',
    'Take the Plant Match quiz to find plants that fit your space.', '/match');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
