-- =============================================================================
-- Nishorgo 2.0 · 11 · Security: Row Level Security, grants, JWT role hook
-- Every table has RLS on. Clients can only ever see/touch their own rows;
-- staff see everything; money/stock/points move only through functions.
-- =============================================================================

alter table public.profiles             enable row level security;
alter table public.addresses            enable row level security;
alter table public.categories           enable row level security;
alter table public.products             enable row level security;
alter table public.inventory_movements  enable row level security;
alter table public.notifications        enable row level security;
alter table public.loyalty_ledger       enable row level security;
alter table public.wishlist_items       enable row level security;
alter table public.cart_items           enable row level security;
alter table public.coupons              enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.order_status_history enable row level security;
alter table public.coupon_redemptions   enable row level security;
alter table public.stripe_events        enable row level security;
alter table public.reviews              enable row level security;
alter table public.review_votes         enable row level security;
alter table public.garden_plants        enable row level security;
alter table public.care_logs            enable row level security;
alter table public.audit_log            enable row level security;
alter table public.journal_posts        enable row level security;

-- (select auth.uid()) is wrapped in a sub-select so Postgres evaluates it once
-- per statement instead of once per row.

-- profiles ---------------------------------------------------------------------
create policy "profiles: read own or staff" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.is_staff()));
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles: admin manages" on public.profiles
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- addresses --------------------------------------------------------------------
create policy "addresses: owner all" on public.addresses
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "addresses: staff read" on public.addresses
  for select to authenticated using ((select public.is_staff()));

-- catalog ----------------------------------------------------------------------
create policy "categories: public read" on public.categories
  for select to anon, authenticated using (true);
create policy "categories: staff write" on public.categories
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "products: public read active" on public.products
  for select to anon, authenticated using (is_active or (select public.is_staff()));
create policy "products: staff write" on public.products
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "inventory: staff read" on public.inventory_movements
  for select to authenticated using ((select public.is_staff()));

-- engagement -------------------------------------------------------------------
create policy "notifications: owner read" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications: owner mark read" on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications: owner delete" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));
-- Only read_at is client-writable.
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "loyalty: owner or staff read" on public.loyalty_ledger
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_staff()));

create policy "wishlist: owner all" on public.wishlist_items
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "cart: owner all" on public.cart_items
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- commerce ---------------------------------------------------------------------
create policy "coupons: staff all" on public.coupons
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "orders: owner or staff read" on public.orders
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_staff()));

create policy "order_items: via order" on public.order_items
  for select to authenticated using (exists (
    select 1 from public.orders o where o.id = order_id
       and (o.user_id = (select auth.uid()) or (select public.is_staff()))));

create policy "order_history: via order" on public.order_status_history
  for select to authenticated using (exists (
    select 1 from public.orders o where o.id = order_id
       and (o.user_id = (select auth.uid()) or (select public.is_staff()))));

create policy "coupon_redemptions: owner or staff" on public.coupon_redemptions
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_staff()));

-- stripe_events: no policies → invisible to every API role.

-- reviews ----------------------------------------------------------------------
create policy "reviews: public read" on public.reviews
  for select to anon, authenticated using (true);
create policy "reviews: author insert" on public.reviews
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "reviews: author update" on public.reviews
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "reviews: author or staff delete" on public.reviews
  for delete to authenticated using (user_id = (select auth.uid()) or (select public.is_staff()));

create policy "review_votes: public read" on public.review_votes
  for select to anon, authenticated using (true);
create policy "review_votes: voter insert" on public.review_votes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "review_votes: voter delete" on public.review_votes
  for delete to authenticated using (user_id = (select auth.uid()));

-- garden -----------------------------------------------------------------------
create policy "garden: owner read" on public.garden_plants
  for select to authenticated using (user_id = (select auth.uid()));
-- Customers can add their own plants, but can't forge "bought here" links.
create policy "garden: owner insert" on public.garden_plants
  for insert to authenticated with check (user_id = (select auth.uid()) and source_order_item_id is null);
create policy "garden: owner update" on public.garden_plants
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "garden: owner delete" on public.garden_plants
  for delete to authenticated using (user_id = (select auth.uid()));
-- Care timestamps are trigger-maintained.
revoke update on public.garden_plants from anon, authenticated;
grant update (nickname, location, photo_url, light, water_every_days, fertilize_every_days, is_archived)
  on public.garden_plants to authenticated;

create policy "care_logs: owner read" on public.care_logs
  for select to authenticated using (user_id = (select auth.uid()));
create policy "care_logs: owner insert" on public.care_logs
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "care_logs: owner delete" on public.care_logs
  for delete to authenticated using (user_id = (select auth.uid()));

-- audit ------------------------------------------------------------------------
create policy "audit: staff read" on public.audit_log
  for select to authenticated using ((select public.is_staff()));

-- journal ----------------------------------------------------------------------
create policy "journal: public read published" on public.journal_posts
  for select to anon, authenticated using (published_at <= now() or (select public.is_staff()));
create policy "journal: staff write" on public.journal_posts
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

-- -----------------------------------------------------------------------------
-- Table grants: anon gets read-only access to public catalog tables only.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select on public.categories, public.products, public.reviews, public.review_votes,
                public.journal_posts to anon;
revoke all on public.stripe_events, public.audit_log, public.inventory_movements from anon, authenticated;
grant select on public.audit_log, public.inventory_movements to authenticated;   -- RLS: staff only
revoke insert, update, delete on public.orders, public.order_items, public.order_status_history,
  public.loyalty_ledger, public.coupon_redemptions from authenticated;

-- -----------------------------------------------------------------------------
-- Function grants
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.slugify(text),
  public.loyalty_tier(integer),
  public.shipping_fee_for(numeric),
  public.max_redeemable_points(numeric, integer),
  public.points_for_order(numeric, integer),
  public.order_transition_allowed(public.order_status, public.order_status),
  public.is_staff(), public.is_admin(), public.current_user_role(),
  public.search_products(text, text, numeric, numeric, public.light_level[], public.care_difficulty[], boolean, boolean, text, integer, integer),
  public.product_detail(text),
  public.product_recommendations(bigint, integer),
  public.plant_match(public.light_level, public.care_difficulty, boolean, integer, text[], integer),
  public.product_reviews(bigint, text, integer, integer),
  public.journal_list(text, text, integer, integer),
  public.journal_post(text)
to anon;

-- `private` helpers that invoker-rights functions need.
grant usage on schema private to anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.require_user(),
  private.product_card(public.products),
  private.plant_schedule(public.garden_plants)
to anon, authenticated;
grant execute on function private.require_staff() to authenticated;

-- -----------------------------------------------------------------------------
-- Custom Access Token Hook: stamps `user_role` into every JWT so the frontend
-- and the PHP API can gate admin UI without an extra query.
-- Enable in Dashboard → Authentication → Hooks → Customize Access Token.
-- -----------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims jsonb := event -> 'claims';
  v_role   public.user_role;
begin
  select role into v_role from public.profiles where id = (event ->> 'user_id')::uuid;
  v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(coalesce(v_role, 'customer')::text));
  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on public.profiles to supabase_auth_admin;
create policy "profiles: auth hook read" on public.profiles
  for select to supabase_auth_admin using (true);
