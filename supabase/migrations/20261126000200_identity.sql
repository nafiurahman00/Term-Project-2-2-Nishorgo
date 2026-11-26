-- =============================================================================
-- Nishorgo 2.0 · 02 · Identity
-- Profiles (1:1 with auth.users), addresses, role helpers, signup trigger,
-- and a Custom Access Token Hook that stamps the user's role into the JWT.
-- =============================================================================

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             extensions.citext,
  full_name         text check (char_length(full_name) <= 120),
  username          extensions.citext unique check (username ~ '^[a-zA-Z0-9_]{3,30}$'),
  avatar_url        text,
  phone             text check (phone ~ '^\+?[0-9 \-]{6,20}$'),
  role              public.user_role not null default 'customer',
  loyalty_points    integer not null default 0 check (loyalty_points >= 0),
  lifetime_points   integer not null default 0 check (lifetime_points >= 0),
  care_streak       integer not null default 0,
  best_care_streak  integer not null default 0,
  last_care_on      date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.profiles is 'Public profile for every auth user. Balances are maintained by triggers only.';

create table public.addresses (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  label        text not null default 'Home' check (char_length(label) <= 40),
  recipient    text not null check (char_length(recipient) between 2 and 120),
  phone        text not null check (phone ~ '^\+?[0-9 \-]{6,20}$'),
  line1        text not null check (char_length(line1) between 3 and 200),
  line2        text,
  area         text,
  city         text not null default 'Dhaka',
  postal_code  text,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now()
);
create index addresses_user_idx on public.addresses (user_id);
-- At most one default address per user, enforced by the database.
create unique index addresses_one_default_idx on public.addresses (user_id) where is_default;

-- -----------------------------------------------------------------------------
-- Role helpers (used by RLS policies everywhere)
-- -----------------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.role from public.profiles p where p.id = auth.uid()), 'customer'::public.user_role);
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role in ('staff', 'admin'));
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'admin');
$$;

-- -----------------------------------------------------------------------------
-- Guard: customers may edit their profile, but never their role or balances.
-- Balances move only through ledger triggers (which run as the table owner).
-- -----------------------------------------------------------------------------
create or replace function private.guard_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only enforce for API roles; triggers/migrations run as postgres.
  if current_user in ('authenticated', 'anon') then
    if new.role is distinct from old.role and not public.is_admin() then
      raise exception 'Only admins can change roles' using errcode = '42501';
    end if;
    if new.loyalty_points  is distinct from old.loyalty_points
       or new.lifetime_points is distinct from old.lifetime_points
       or new.care_streak     is distinct from old.care_streak
       or new.best_care_streak is distinct from old.best_care_streak then
      raise exception 'Balances are managed by the system' using errcode = '42501';
    end if;
    if new.id is distinct from old.id or new.email is distinct from old.email then
      raise exception 'Identity columns are immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function private.guard_profile_columns();

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

-- Keep a single default address: setting a new default clears the old one.
create or replace function private.single_default_address()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_default then
    update public.addresses
       set is_default = false
     where user_id = new.user_id and id <> new.id and is_default;
  elsif not exists (select 1 from public.addresses where user_id = new.user_id and is_default and id <> new.id) then
    -- First address becomes the default automatically.
    new.is_default := true;
  end if;
  return new;
end;
$$;

create trigger addresses_single_default
  before insert or update of is_default on public.addresses
  for each row execute function private.single_default_address();
