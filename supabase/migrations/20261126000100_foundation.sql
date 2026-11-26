-- =============================================================================
-- Nishorgo 2.0 · 01 · Foundation
-- Extensions, enum types, and generic helper functions used by every module.
-- =============================================================================

create extension if not exists pg_trgm   with schema extensions;
create extension if not exists unaccent  with schema extensions;
create extension if not exists citext    with schema extensions;

-- Private schema: internal helpers that must never be callable through the API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
-- Functions created in `private` are owner-only unless explicitly granted.
alter default privileges in schema private revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Enum types
-- -----------------------------------------------------------------------------
create type public.user_role         as enum ('customer', 'staff', 'admin');
create type public.order_status      as enum ('pending_payment', 'paid', 'processing', 'shipped',
                                              'delivered', 'cancelled', 'refunded');
create type public.light_level       as enum ('low', 'medium', 'bright_indirect', 'full_sun');
create type public.care_difficulty   as enum ('easy', 'moderate', 'expert');
create type public.care_task         as enum ('water', 'fertilize', 'mist', 'prune', 'repot');
create type public.discount_kind     as enum ('percent', 'fixed');
create type public.inventory_reason  as enum ('initial', 'restock', 'sale', 'cancellation', 'adjustment', 'damage');
create type public.loyalty_reason    as enum ('signup_bonus', 'order_earned', 'order_redeemed',
                                              'redemption_refund', 'earned_reversal', 'review_bonus', 'admin_adjustment');
create type public.notification_kind as enum ('order', 'stock', 'price_drop', 'care', 'loyalty', 'review', 'system', 'admin');

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------

-- Keeps updated_at honest on any table that has it.
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- URL-safe slug: "Jack Fruit Tree!" -> "jack-fruit-tree"
create or replace function public.slugify(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select trim(both '-' from
           regexp_replace(
             regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_text)),
                            '[''’]', '', 'g'),          -- "here's" -> "heres"
             '[^a-z0-9]+', '-', 'g'));
$$;

-- array_to_string() is only STABLE (generic element output); for text[] it is
-- safe to treat as immutable, which generated tsvector columns require.
create or replace function public.immutable_join(p_parts text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array_to_string(p_parts, ' ');
$$;

-- Assigns a unique slug derived from a source column when slug is empty.
-- Usage: before insert or update trigger, tg_argv[0] = source column name.
create or replace function private.assign_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_source text := to_jsonb(new) ->> tg_argv[0];
  v_base   text;
  v_slug   text;
  v_n      int := 1;
  v_taken  boolean;
begin
  if new.slug is not null and new.slug <> '' then
    new.slug := public.slugify(new.slug);
    return new;
  end if;

  v_base := coalesce(nullif(public.slugify(v_source), ''), 'item');
  v_slug := v_base;
  loop
    execute format('select exists(select 1 from %I.%I where slug = $1 and id is distinct from $2)',
                   tg_table_schema, tg_table_name)
      into v_taken using v_slug, new.id;
    exit when not v_taken;
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  new.slug := v_slug;
  return new;
end;
$$;
