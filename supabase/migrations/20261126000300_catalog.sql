-- =============================================================================
-- Nishorgo 2.0 · 03 · Catalog & Inventory
-- Categories, products (with care metadata + full-text search vector), and an
-- append-only inventory ledger. Stock on `products` is a cached balance that
-- ONLY the ledger trigger may change (fixes the legacy cart-decrements-stock bug).
-- =============================================================================

create table public.categories (
  id          smallint generated always as identity primary key,
  slug        text not null unique,
  name        text not null unique,
  tagline     text,
  emoji       text,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now()
);

create trigger categories_assign_slug
  before insert or update of name, slug on public.categories
  for each row execute function private.assign_slug('name');

create table public.products (
  id                   bigint generated always as identity primary key,
  slug                 text not null unique,
  name                 text not null check (char_length(name) between 2 and 80),
  scientific_name      text,
  category_id          smallint not null references public.categories (id) on delete restrict,
  short_description    text check (char_length(short_description) <= 200),
  description          text,
  price                numeric(10,2) not null check (price > 0),
  compare_at_price     numeric(10,2) check (compare_at_price is null or compare_at_price > price),
  stock                integer not null default 0 check (stock >= 0),
  low_stock_threshold  integer not null default 5 check (low_stock_threshold >= 0),
  image_url            text,
  gallery              text[] not null default '{}',
  -- Plant care metadata powers filters, the Plant Match quiz, and My Garden.
  light                public.light_level not null default 'bright_indirect',
  difficulty           public.care_difficulty not null default 'easy',
  water_every_days     smallint not null default 3 check (water_every_days between 1 and 60),
  fertilize_every_days smallint check (fertilize_every_days between 7 and 365),
  pet_friendly         boolean not null default false,
  air_purifying        boolean not null default false,
  edible               boolean not null default false,
  mature_height_cm     smallint,
  tags                 text[] not null default '{}',
  -- Aggregates maintained by triggers.
  rating_avg           numeric(2,1) not null default 0,
  rating_count         integer not null default 0,
  sold_count           integer not null default 0,
  wishlist_count       integer not null default 0,
  is_active            boolean not null default true,
  is_featured          boolean not null default false,
  search_vector        tsvector generated always as (
                         setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
                         setweight(to_tsvector('simple', coalesce(scientific_name, '')), 'A') ||
                         setweight(to_tsvector('english', coalesce(public.immutable_join(tags), '')), 'B') ||
                         setweight(to_tsvector('english', coalesce(short_description, '')), 'C') ||
                         setweight(to_tsvector('english', coalesce(description, '')), 'D')
                       ) stored,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on column public.products.stock is 'Cached balance of inventory_movements. Never update directly.';

create index products_category_idx on public.products (category_id) where is_active;
create index products_search_idx   on public.products using gin (search_vector);
create index products_name_trgm    on public.products using gin (name extensions.gin_trgm_ops);
create index products_price_idx    on public.products (price) where is_active;
create index products_tags_idx     on public.products using gin (tags);

create trigger products_assign_slug
  before insert or update of name, slug on public.products
  for each row execute function private.assign_slug('name');

create trigger products_touch_updated_at
  before update on public.products
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Inventory ledger
-- -----------------------------------------------------------------------------
create table public.inventory_movements (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references public.products (id) on delete cascade,
  delta       integer not null check (delta <> 0),
  reason      public.inventory_reason not null,
  order_id    uuid,          -- FK added in the orders migration
  note        text,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index inventory_movements_product_idx on public.inventory_movements (product_id, created_at desc);
comment on table public.inventory_movements is 'Append-only stock ledger. products.stock = sum(delta).';

-- Apply each movement to the cached stock balance. The CHECK (stock >= 0)
-- on products makes overselling impossible at the database level.
create or replace function private.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.products
     set stock = stock + new.delta
   where id = new.product_id;
  return new;
exception
  when check_violation then
    raise exception 'Insufficient stock for product %', new.product_id
      using errcode = 'P0001', hint = 'out_of_stock';
end;
$$;

create trigger inventory_movements_apply
  after insert on public.inventory_movements
  for each row execute function private.apply_inventory_movement();

-- The ledger is append-only.
create or replace function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

create trigger inventory_movements_append_only
  before update or delete on public.inventory_movements
  for each row execute function private.forbid_mutation();

-- Block direct writes to products.stock from API roles; stock must go through the ledger.
create or replace function private.guard_product_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.stock is distinct from old.stock then
      raise exception 'Use restock_product() — stock is ledger-managed' using errcode = '42501';
    end if;
    if new.rating_avg is distinct from old.rating_avg
       or new.rating_count is distinct from old.rating_count
       or new.sold_count is distinct from old.sold_count
       or new.wishlist_count is distinct from old.wishlist_count then
      raise exception 'Aggregate columns are trigger-managed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger products_guard_stock
  before update on public.products
  for each row execute function private.guard_product_stock();

-- New products start with stock 0; an initial stock value on INSERT is moved
-- into the ledger so the invariant stock = sum(movements) always holds.
create or replace function private.product_initial_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initial integer;
begin
  v_initial := new.stock;
  if v_initial > 0 then
    update public.products set stock = 0 where id = new.id;
    insert into public.inventory_movements (product_id, delta, reason, note)
    values (new.id, v_initial, 'initial', 'Opening stock');
  end if;
  return null;
end;
$$;

create trigger products_initial_stock
  after insert on public.products
  for each row execute function private.product_initial_stock();
