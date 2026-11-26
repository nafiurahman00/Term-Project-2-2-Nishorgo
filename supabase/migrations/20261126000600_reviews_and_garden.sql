-- =============================================================================
-- Nishorgo 2.0 · 06 · Reviews & My Garden
-- Verified-purchase reviews with photos and helpful votes; a personal plant
-- garden auto-populated on delivery, care logs, streaks and a care schedule.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Reviews
-- -----------------------------------------------------------------------------
create table public.reviews (
  id                    bigint generated always as identity primary key,
  product_id            bigint not null references public.products (id) on delete cascade,
  user_id               uuid not null references public.profiles (id) on delete cascade,
  rating                smallint not null check (rating between 1 and 5),
  title                 text check (char_length(title) <= 120),
  body                  text check (char_length(body) <= 4000),
  photos                text[] not null default '{}' check (cardinality(photos) <= 4),
  is_verified_purchase  boolean not null default false,
  helpful_count         integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (product_id, user_id)
);
create index reviews_product_idx on public.reviews (product_id, helpful_count desc, created_at desc);

create table public.review_votes (
  review_id   bigint not null references public.reviews (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (review_id, user_id)
);

create trigger reviews_touch_updated_at
  before update on public.reviews
  for each row execute function private.touch_updated_at();

-- Verified badge is computed by the database, never trusted from the client.
-- Runs as the invoker on purpose: when a *client* (authenticated) writes, the
-- helpful_count is pinned; when the vote-counter trigger (security definer,
-- current_user = owner) writes, the new count is allowed through.
create or replace function private.reviews_mark_verified()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.is_verified_purchase := exists (
    select 1
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
     where o.user_id = new.user_id
       and oi.product_id = new.product_id
       and o.status = 'delivered');
  if current_user in ('authenticated', 'anon') then
    new.helpful_count := case when tg_op = 'UPDATE' then old.helpful_count else 0 end;
    if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.product_id <> old.product_id) then
      raise exception 'Review owner/product are immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger reviews_mark_verified
  before insert or update on public.reviews
  for each row execute function private.reviews_mark_verified();

-- Exact recomputation of the product rating (replaces the legacy running-average
-- procedure, which drifted and allowed unlimited re-rating).
create or replace function private.reviews_refresh_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product bigint := coalesce(new.product_id, old.product_id);
begin
  update public.products p
     set rating_avg   = coalesce(r.avg, 0),
         rating_count = r.cnt
    from (select round(avg(rating)::numeric, 1) as avg, count(*)::int as cnt
            from public.reviews where product_id = v_product) r
   where p.id = v_product;
  return null;
end;
$$;

create trigger reviews_refresh_rating
  after insert or update of rating or delete on public.reviews
  for each row execute function private.reviews_refresh_rating();

-- First verified review of a product earns 20 bonus points.
create or replace function private.reviews_bonus_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_verified_purchase and not exists (
       select 1 from public.loyalty_ledger l
        where l.user_id = new.user_id and l.reason = 'review_bonus'
          and l.note = 'Review bonus · product ' || new.product_id) then
    insert into public.loyalty_ledger (user_id, delta, reason, note)
    values (new.user_id, 20, 'review_bonus', 'Review bonus · product ' || new.product_id);
  end if;
  return null;
end;
$$;

create trigger reviews_bonus_points
  after insert on public.reviews
  for each row execute function private.reviews_bonus_points();

create or replace function private.review_votes_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.reviews where id = new.review_id and user_id = new.user_id) then
      raise exception 'You cannot vote on your own review' using errcode = 'P0001';
    end if;
    update public.reviews set helpful_count = helpful_count + 1 where id = new.review_id;
    return new;
  else
    update public.reviews set helpful_count = greatest(helpful_count - 1, 0) where id = old.review_id;
    return old;
  end if;
end;
$$;

create trigger review_votes_counter
  after insert or delete on public.review_votes
  for each row execute function private.review_votes_counter();

-- -----------------------------------------------------------------------------
-- My Garden
-- -----------------------------------------------------------------------------
create table public.garden_plants (
  id                    bigint generated always as identity primary key,
  user_id               uuid not null references public.profiles (id) on delete cascade,
  product_id            bigint references public.products (id) on delete set null,
  source_order_item_id  bigint references public.order_items (id) on delete set null,
  source_unit           smallint,   -- 2 roses bought = 2 garden plants (#1, #2)
  nickname              text not null check (char_length(nickname) between 1 and 60),
  species               text,
  location              text check (char_length(location) <= 60),
  photo_url             text,
  light                 public.light_level,
  water_every_days      smallint not null default 3 check (water_every_days between 1 and 60),
  fertilize_every_days  smallint check (fertilize_every_days between 7 and 365),
  acquired_on           date not null default current_date,
  last_watered_at       timestamptz,
  last_fertilized_at    timestamptz,
  last_misted_at        timestamptz,
  is_archived           boolean not null default false,
  created_at            timestamptz not null default now(),
  unique (source_order_item_id, source_unit)
);
create index garden_plants_user_idx on public.garden_plants (user_id) where not is_archived;

create table public.care_logs (
  id         bigint generated always as identity primary key,
  plant_id   bigint not null references public.garden_plants (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  task       public.care_task not null,
  note       text check (char_length(note) <= 280),
  done_at    timestamptz not null default now()
);
create index care_logs_plant_idx on public.care_logs (plant_id, done_at desc);
create index care_logs_user_idx  on public.care_logs (user_id, done_at desc);

-- Logging care updates the plant's "last done" timestamps and the user's daily streak.
create or replace function private.care_logs_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (new.done_at at time zone 'Asia/Dhaka')::date;
  v_last  date;
  v_streak integer;
begin
  if not exists (select 1 from public.garden_plants where id = new.plant_id and user_id = new.user_id) then
    raise exception 'Plant not found in your garden' using errcode = 'P0001';
  end if;

  update public.garden_plants
     set last_watered_at    = case when new.task = 'water'     then greatest(last_watered_at, new.done_at)    else last_watered_at end,
         last_fertilized_at = case when new.task = 'fertilize' then greatest(last_fertilized_at, new.done_at) else last_fertilized_at end,
         last_misted_at     = case when new.task = 'mist'      then greatest(last_misted_at, new.done_at)     else last_misted_at end
   where id = new.plant_id;

  select last_care_on, care_streak into v_last, v_streak from public.profiles where id = new.user_id for update;
  if v_last is null or v_today > v_last then
    v_streak := case when v_last = v_today - 1 then v_streak + 1 else 1 end;
    update public.profiles
       set care_streak = v_streak,
           best_care_streak = greatest(best_care_streak, v_streak),
           last_care_on = v_today
     where id = new.user_id;

    if v_streak in (7, 30, 100) then
      insert into public.loyalty_ledger (user_id, delta, reason, note)
      values (new.user_id, v_streak * 2, 'admin_adjustment', format('%s-day care streak! 🔥', v_streak));
    end if;
  end if;
  return new;
end;
$$;

create trigger care_logs_apply
  after insert on public.care_logs
  for each row execute function private.care_logs_apply();

-- When an order is delivered, every plant in it is planted into the buyer's garden.
create or replace function private.orders_plant_garden()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    insert into public.garden_plants
      (user_id, product_id, source_order_item_id, source_unit, nickname, species, photo_url,
       light, water_every_days, fertilize_every_days, acquired_on)
    select new.user_id, p.id, oi.id, g.n,
           oi.product_name || case when g.n > 1 then ' #' || g.n else '' end,
           p.scientific_name, p.image_url, p.light, p.water_every_days, p.fertilize_every_days,
           current_date
      from public.order_items oi
      join public.products p on p.id = oi.product_id
      cross join lateral generate_series(1, least(oi.quantity, 10)) as g(n)
     where oi.order_id = new.id
    on conflict (source_order_item_id, source_unit) do nothing;
  end if;
  return new;
end;
$$;

create trigger orders_plant_garden
  after update of status on public.orders
  for each row execute function private.orders_plant_garden();
