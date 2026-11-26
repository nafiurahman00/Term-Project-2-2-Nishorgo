-- =============================================================================
-- Nishorgo 2.0 · 08 · API functions
-- Business logic lives in the database. The PHP API calls these functions
-- with the end-user's identity (role `authenticated` + JWT claims), so
-- auth.uid() and RLS work exactly as they would through PostgREST.
--
-- Error contract: business errors raise SQLSTATE P0001 with a machine-readable
-- HINT (e.g. 'out_of_stock'); the API maps them to HTTP 422.
-- =============================================================================

create or replace function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '42501', hint = 'unauthenticated';
  end if;
  return v_uid;
end;
$$;

create or replace function private.require_staff()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff access required' using errcode = '42501', hint = 'forbidden';
  end if;
  return auth.uid();
end;
$$;

-- Compact JSON shape for product cards, reused across endpoints.
create or replace function private.product_card(p public.products)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'scientific_name', p.scientific_name,
    'price', p.price, 'compare_at_price', p.compare_at_price, 'image_url', p.image_url,
    'stock', p.stock, 'rating_avg', p.rating_avg, 'rating_count', p.rating_count,
    'light', p.light, 'difficulty', p.difficulty, 'pet_friendly', p.pet_friendly,
    'air_purifying', p.air_purifying, 'edible', p.edible, 'tags', p.tags,
    'is_featured', p.is_featured, 'sold_count', p.sold_count,
    'category', (select jsonb_build_object('slug', c.slug, 'name', c.name, 'emoji', c.emoji)
                   from public.categories c where c.id = p.category_id));
$$;

-- =============================================================================
-- Catalog
-- =============================================================================

-- Full-text + fuzzy (trigram) search with faceted filters and pagination.
-- "monstra" still finds "Monstera"; "purple flower" ranks Lavender/Lilac high.
create or replace function public.search_products(
  p_query        text default null,
  p_category     text default null,
  p_min_price    numeric default null,
  p_max_price    numeric default null,
  p_light        public.light_level[] default null,
  p_difficulty   public.care_difficulty[] default null,
  p_pet_friendly boolean default null,
  p_in_stock     boolean default null,
  p_sort         text default 'relevance',
  p_limit        integer default 24,
  p_offset       integer default 0)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_q       text := nullif(trim(p_query), '');
  v_tsq     tsquery := case when v_q is not null then websearch_to_tsquery('english', v_q) end;
  v_result  jsonb;
begin
  with matches as (
    select p,
           case when v_q is null then 0
                else ts_rank_cd(p.search_vector, v_tsq) * 2
                     + extensions.similarity(p.name, v_q)
                     + extensions.similarity(coalesce(p.scientific_name, ''), v_q) * 0.5
           end as rank
      from public.products p
      join public.categories c on c.id = p.category_id
     where p.is_active
       and (p_category is null or c.slug = p_category)
       and (p_min_price is null or p.price >= p_min_price)
       and (p_max_price is null or p.price <= p_max_price)
       and (p_light is null or p.light = any (p_light))
       and (p_difficulty is null or p.difficulty = any (p_difficulty))
       and (p_pet_friendly is null or p.pet_friendly = p_pet_friendly)
       and (p_in_stock is not true or p.stock > 0)
       and (v_q is null
            or p.search_vector @@ v_tsq
            or extensions.word_similarity(v_q, p.name) > 0.4
            or extensions.word_similarity(v_q, coalesce(p.scientific_name, '')) > 0.4
            or p.name ilike '%' || v_q || '%')
  ), ordered as (
    select m.*,
           row_number() over (order by
             case when p_sort = 'relevance' and v_q is not null then m.rank end desc nulls last,
             case when p_sort = 'popular'    then (m.p).sold_count end desc,
             case when p_sort = 'price_asc'  then (m.p).price end asc,
             case when p_sort = 'price_desc' then (m.p).price end desc,
             case when p_sort = 'rating'     then (m.p).rating_avg end desc,
             case when p_sort = 'newest'     then (m.p).created_at end desc,
             (m.p).is_featured desc, (m.p).sold_count desc, (m.p).id) as rn
      from matches m
  )
  select jsonb_build_object(
           'total', (select count(*) from matches),
           'items', coalesce((
              select jsonb_agg(private.product_card(o.p) || jsonb_build_object('rank', round(o.rank::numeric, 3))
                               order by o.rn)
                from ordered o
               where o.rn > greatest(p_offset, 0)
                 and o.rn <= greatest(p_offset, 0) + least(greatest(p_limit, 1), 100)), '[]'::jsonb))
    into v_result;

  -- Facet counts power the filter sidebar.
  return v_result || jsonb_build_object(
    'facets', jsonb_build_object(
      'categories', (select coalesce(jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name, 'emoji', c.emoji,
                                                                  'count', (select count(*) from public.products p2
                                                                            where p2.category_id = c.id and p2.is_active))
                                               order by c.sort_order), '[]'::jsonb)
                       from public.categories c),
      'price_range', (select jsonb_build_object('min', coalesce(min(price), 0), 'max', coalesce(max(price), 0))
                        from public.products where is_active)));
end;
$$;

create or replace function public.product_detail(p_slug text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_p        public.products;
  v_uid      uuid := auth.uid();
  v_personal jsonb := jsonb_build_object('is_wishlisted', false, 'in_cart', 0, 'can_review', false);
begin
  select * into v_p from public.products where slug = p_slug and (is_active or public.is_staff());
  if not found then
    raise exception 'Plant not found' using errcode = 'P0002', hint = 'not_found';
  end if;

  -- Personal fields only for signed-in users (anon has no grants on these tables).
  if v_uid is not null then
    v_personal := jsonb_build_object(
      'is_wishlisted', exists (select 1 from public.wishlist_items w where w.user_id = v_uid and w.product_id = v_p.id),
      'in_cart', coalesce((select c.quantity from public.cart_items c where c.user_id = v_uid and c.product_id = v_p.id), 0),
      'can_review', exists (select 1 from public.orders o join public.order_items oi on oi.order_id = o.id
                             where o.user_id = v_uid and oi.product_id = v_p.id and o.status = 'delivered'));
  end if;

  return private.product_card(v_p) || v_personal || jsonb_build_object(
    'short_description', v_p.short_description,
    'description', v_p.description,
    'gallery', v_p.gallery,
    'water_every_days', v_p.water_every_days,
    'fertilize_every_days', v_p.fertilize_every_days,
    'mature_height_cm', v_p.mature_height_cm,
    'wishlist_count', v_p.wishlist_count,
    'low_stock', v_p.stock > 0 and v_p.stock <= v_p.low_stock_threshold,
    'rating_distribution', (
      select jsonb_object_agg(s.star, coalesce(r.cnt, 0) order by s.star desc)
        from generate_series(1, 5) as s(star)
        left join (select rating, count(*) cnt from public.reviews
                    where product_id = v_p.id group by rating) r on r.rating = s.star));
end;
$$;

-- "Customers who bought this also bought" via order co-occurrence, padded with
-- plants that share category and care profile.
create or replace function public.product_recommendations(p_product_id bigint, p_limit integer default 6)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (select * from public.products where id = p_product_id),
  co_bought as (
    select oi2.product_id, count(distinct oi1.order_id) * 10.0 as score
      from public.order_items oi1
      join public.orders o on o.id = oi1.order_id and o.status in ('paid', 'processing', 'shipped', 'delivered')
      join public.order_items oi2 on oi2.order_id = oi1.order_id and oi2.product_id <> oi1.product_id
     where oi1.product_id = p_product_id
     group by oi2.product_id
  ),
  alike as (
    select p.id as product_id,
           (case when p.category_id = b.category_id then 3 else 0 end)
         + (case when p.light = b.light then 2 else 0 end)
         + (case when p.difficulty = b.difficulty then 1 else 0 end)
         + (case when p.pet_friendly = b.pet_friendly then 0.5 else 0 end)
         + coalesce(cardinality(array(select unnest(p.tags) intersect select unnest(b.tags))), 0)
         + p.rating_avg / 5.0 as score
      from public.products p, base b
     where p.id <> b.id
  ),
  scored as (
    select product_id, sum(score) as score, bool_or(src = 'co') as co_bought
      from (select product_id, score, 'co' as src from co_bought
            union all
            select product_id, score, 'sim' from alike) s
     group by product_id
  )
  select coalesce(jsonb_agg(private.product_card(p) || jsonb_build_object('reason',
           case when s.co_bought then 'Often bought together' else 'Similar care needs' end)
           order by s.score desc), '[]'::jsonb)
    from (select * from scored order by score desc limit p_limit) s
    join public.products p on p.id = s.product_id
   where p.is_active and p.stock > 0;
$$;

-- Plant Match quiz: scores every plant against the shopper's space and
-- lifestyle and explains *why* each one matches.
create or replace function public.plant_match(
  p_light           public.light_level,
  p_experience      public.care_difficulty,
  p_has_pets        boolean default false,
  p_water_tolerance integer default 7,          -- "I can water roughly every N days"
  p_wants           text[] default '{}',        -- any of: flowers, edible, air_purifying, compact
  p_limit           integer default 6)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with light_rank(l, r) as (
    values ('low'::public.light_level, 1), ('medium', 2), ('bright_indirect', 3), ('full_sun', 4)
  ), diff_rank(d, r) as (
    values ('easy'::public.care_difficulty, 1), ('moderate', 2), ('expert', 3)
  ), scored as (
    select p,
           c.slug as category_slug,
           -- light: exact = 40, one step away = 20
           greatest(0, 40 - 20 * abs(lp.r - lu.r)) as light_score,
           -- difficulty: at or below your experience = 25
           case when dp.r <= du.r then 25 else greatest(0, 25 - 15 * (dp.r - du.r)) end as diff_score,
           -- watering: plant's interval >= what you can manage
           case when p.water_every_days >= p_water_tolerance then 20
                else greatest(0, 20 - 4 * (p_water_tolerance - p.water_every_days)) end as water_score,
           (case when 'flowers' = any (p_wants) and c.slug = 'flowering' then 10 else 0 end
          + case when 'edible' = any (p_wants) and p.edible then 10 else 0 end
          + case when 'air_purifying' = any (p_wants) and p.air_purifying then 10 else 0 end
          + case when 'compact' = any (p_wants) and coalesce(p.mature_height_cm, 999) <= 60 then 10 else 0 end) as wants_score
      from public.products p
      join public.categories c on c.id = p.category_id
      join light_rank lp on lp.l = p.light
      join light_rank lu on lu.l = p_light
      join diff_rank dp on dp.d = p.difficulty
      join diff_rank du on du.d = p_experience
     where p.is_active and p.stock > 0
       and (not p_has_pets or p.pet_friendly)
  )
  select coalesce(jsonb_agg(private.product_card(s.p) || jsonb_build_object(
           'match', least(100, s.light_score + s.diff_score + s.water_score + s.wants_score + 5),
           'reasons', array_remove(array[
              case when s.light_score = 40 then 'Perfect for your light' end,
              case when s.light_score = 20 then 'Adapts to your light' end,
              case when s.diff_score = 25 then 'Matches your experience' end,
              case when s.water_score = 20 then 'Fits your watering rhythm' end,
              case when p_has_pets then 'Safe around pets' end,
              case when (s.p).air_purifying and 'air_purifying' = any (p_wants) then 'Purifies the air' end,
              case when (s.p).edible and 'edible' = any (p_wants) then 'You can eat what it grows' end,
              case when s.category_slug = 'flowering' and 'flowers' = any (p_wants) then 'Blooms beautifully' end
           ], null))
           order by s.light_score + s.diff_score + s.water_score + s.wants_score desc, (s.p).rating_avg desc), '[]'::jsonb)
    from (select * from scored
          order by light_score + diff_score + water_score + wants_score desc, (p).rating_avg desc
          limit p_limit) s;
$$;

-- =============================================================================
-- Reviews
-- =============================================================================
create or replace function public.product_reviews(
  p_product_id bigint, p_sort text default 'helpful', p_limit integer default 10, p_offset integer default 0)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.reviews where product_id = p_product_id),
    'items', coalesce((
      select jsonb_agg(x.j order by x.ord)
        from (
          select row_number() over (order by
                   case when p_sort = 'helpful' then r.helpful_count end desc nulls last,
                   case when p_sort = 'lowest' then r.rating end asc,
                   case when p_sort = 'highest' then r.rating end desc,
                   r.created_at desc) as ord,
                 jsonb_build_object(
                   'id', r.id, 'rating', r.rating, 'title', r.title, 'body', r.body,
                   'photos', r.photos, 'is_verified_purchase', r.is_verified_purchase,
                   'helpful_count', r.helpful_count, 'created_at', r.created_at,
                   'is_mine', r.user_id = auth.uid(),
                   'has_voted', exists (select 1 from public.review_votes v
                                         where v.review_id = r.id and v.user_id = auth.uid()),
                   'author', jsonb_build_object('name', coalesce(pr.full_name, 'Plant lover'),
                                                'avatar_url', pr.avatar_url,
                                                'tier', public.loyalty_tier(pr.lifetime_points))) as j
            from public.reviews r
            join public.profiles pr on pr.id = r.user_id
           where r.product_id = p_product_id
           order by 1
           limit least(p_limit, 50) offset p_offset) x), '[]'::jsonb));
$$;

create or replace function public.submit_review(
  p_product_id bigint, p_rating smallint, p_title text default null,
  p_body text default null, p_photos text[] default '{}')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_review public.reviews;
begin
  insert into public.reviews (product_id, user_id, rating, title, body, photos)
  values (p_product_id, v_uid, p_rating, nullif(trim(p_title), ''), nullif(trim(p_body), ''), coalesce(p_photos, '{}'))
  on conflict (product_id, user_id) do update
     set rating = excluded.rating, title = excluded.title, body = excluded.body, photos = excluded.photos
  returning * into v_review;
  return to_jsonb(v_review);
end;
$$;

create or replace function public.toggle_review_vote(p_review_id bigint)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  delete from public.review_votes where review_id = p_review_id and user_id = v_uid;
  if found then
    return false;
  end if;
  insert into public.review_votes (review_id, user_id) values (p_review_id, v_uid);
  return true;
end;
$$;

-- =============================================================================
-- Wishlist & cart
-- =============================================================================
create or replace function public.toggle_wishlist(p_product_id bigint)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  delete from public.wishlist_items where user_id = v_uid and product_id = p_product_id;
  if found then
    return false;
  end if;
  insert into public.wishlist_items (user_id, product_id) values (v_uid, p_product_id);
  return true;
end;
$$;

create or replace function public.my_wishlist()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.product_card(p) || jsonb_build_object(
           'added_at', w.created_at,
           'price_when_added', w.price_when_added,
           'price_dropped', p.price < w.price_when_added)
         order by w.created_at desc), '[]'::jsonb)
    from public.wishlist_items w
    join public.products p on p.id = w.product_id
   where w.user_id = auth.uid();
$$;

create or replace function public.cart_summary()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid       uuid := private.require_user();
  v_items     jsonb;
  v_subtotal  numeric;
  v_count     integer;
  v_points    integer;
  v_shipping  numeric;
begin
  select coalesce(jsonb_agg(private.product_card(p) || jsonb_build_object(
           'quantity', c.quantity,
           'line_total', p.price * c.quantity,
           'issue', case when not p.is_active then 'unavailable'
                         when p.stock < c.quantity then 'insufficient_stock' end)
           order by c.added_at), '[]'::jsonb),
         coalesce(sum(p.price * c.quantity) filter (where p.is_active), 0),
         coalesce(sum(c.quantity), 0)
    into v_items, v_subtotal, v_count
    from public.cart_items c
    join public.products p on p.id = c.product_id
   where c.user_id = v_uid;

  select loyalty_points into v_points from public.profiles where id = v_uid;
  v_shipping := case when v_count = 0 then 0 else public.shipping_fee_for(v_subtotal) end;

  return jsonb_build_object(
    'items', v_items,
    'item_count', v_count,
    'subtotal', v_subtotal,
    'shipping_fee', v_shipping,
    'free_shipping_threshold', 1500,
    'free_shipping_remaining', greatest(0, 1500 - v_subtotal),
    'total', v_subtotal + v_shipping,
    'points_balance', coalesce(v_points, 0),
    'max_redeemable_points', public.max_redeemable_points(v_subtotal, coalesce(v_points, 0)));
end;
$$;

-- p_mode 'add' increments, 'set' replaces. Quantity 0 with 'set' removes.
create or replace function public.cart_upsert(p_product_id bigint, p_quantity integer, p_mode text default 'add')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if p_mode = 'set' and p_quantity <= 0 then
    delete from public.cart_items where user_id = v_uid and product_id = p_product_id;
  elsif p_mode = 'set' then
    insert into public.cart_items (user_id, product_id, quantity)
    values (v_uid, p_product_id, p_quantity)
    on conflict (user_id, product_id) do update set quantity = excluded.quantity;
  else
    insert into public.cart_items (user_id, product_id, quantity)
    values (v_uid, p_product_id, greatest(p_quantity, 1))
    on conflict (user_id, product_id) do update set quantity = public.cart_items.quantity + excluded.quantity;
  end if;
  return public.cart_summary();
end;
$$;

create or replace function public.cart_clear()
returns void
language sql
set search_path = ''
as $$
  delete from public.cart_items where user_id = auth.uid();
$$;

-- =============================================================================
-- Coupons & checkout
-- =============================================================================
create or replace function private.coupon_discount(p_code text, p_subtotal numeric, p_user uuid)
returns table (coupon_id bigint, discount numeric, message text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c    public.coupons;
  v_used integer;
  v_d    numeric;
begin
  select * into v_c from public.coupons where lower(code::text) = lower(trim(p_code));
  if not found or not v_c.is_active then
    raise exception 'That coupon code isn''t valid' using errcode = 'P0001', hint = 'coupon_invalid';
  end if;
  if now() < v_c.starts_at or (v_c.ends_at is not null and now() > v_c.ends_at) then
    raise exception 'That coupon has expired' using errcode = 'P0001', hint = 'coupon_expired';
  end if;
  if v_c.usage_limit is not null and v_c.times_used >= v_c.usage_limit then
    raise exception 'That coupon has been fully redeemed' using errcode = 'P0001', hint = 'coupon_exhausted';
  end if;
  select count(*) into v_used from public.coupon_redemptions r where r.coupon_id = v_c.id and r.user_id = p_user;
  if v_used >= v_c.per_user_limit then
    raise exception 'You''ve already used this coupon' using errcode = 'P0001', hint = 'coupon_used';
  end if;
  if p_subtotal < v_c.min_subtotal then
    raise exception 'Spend ৳% more to use %', v_c.min_subtotal - p_subtotal, v_c.code
      using errcode = 'P0001', hint = 'coupon_minimum';
  end if;

  v_d := case v_c.kind when 'percent' then round(p_subtotal * v_c.value / 100, 2) else v_c.value end;
  v_d := least(v_d, coalesce(v_c.max_discount, v_d), p_subtotal);
  return query select v_c.id, v_d, coalesce(v_c.description, format('%s applied', v_c.code));
end;
$$;

-- Price an order without committing anything. Used by the checkout page live.
create or replace function public.checkout_preview(p_coupon_code text default null, p_points integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := private.require_user();
  v_subtotal  numeric;
  v_balance   integer;
  v_discount  numeric := 0;
  v_coupon    jsonb := null;
  v_points    integer;
  v_shipping  numeric;
  r           record;
begin
  select coalesce(sum(p.price * c.quantity), 0) into v_subtotal
    from public.cart_items c join public.products p on p.id = c.product_id
   where c.user_id = v_uid and p.is_active;
  if v_subtotal = 0 then
    raise exception 'Your cart is empty' using errcode = 'P0001', hint = 'cart_empty';
  end if;

  if nullif(trim(p_coupon_code), '') is not null then
    select * into r from private.coupon_discount(trim(p_coupon_code), v_subtotal, v_uid);
    v_discount := r.discount;
    v_coupon := jsonb_build_object('code', upper(trim(p_coupon_code)), 'discount', r.discount, 'message', r.message);
  end if;

  select loyalty_points into v_balance from public.profiles where id = v_uid;
  v_points := least(greatest(coalesce(p_points, 0), 0),
                    public.max_redeemable_points(v_subtotal - v_discount, v_balance));
  v_shipping := public.shipping_fee_for(v_subtotal);

  return jsonb_build_object(
    'subtotal', v_subtotal,
    'discount', v_discount,
    'coupon', v_coupon,
    'points_redeemed', v_points,
    'points_balance', v_balance,
    'max_redeemable_points', public.max_redeemable_points(v_subtotal - v_discount, v_balance),
    'shipping_fee', v_shipping,
    'total', v_subtotal - v_discount - v_points + v_shipping);
end;
$$;

-- Atomically converts the cart into an order:
--   * locks the products (in id order, so concurrent checkouts can't deadlock)
--   * commits stock through the inventory ledger (CHECK stock >= 0 prevents overselling)
--   * snapshots prices, names and the shipping address
--   * applies coupon + Leaf Points, empties the cart
-- The order waits in 'pending_payment' for 30 minutes; unpaid orders are
-- auto-cancelled by pg_cron and their stock is returned.
create or replace function public.place_order(
  p_address_id  bigint,
  p_coupon_code text default null,
  p_points      integer default 0,
  p_notes       text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := private.require_user();
  v_address   public.addresses;
  v_preview   jsonb;
  v_order     public.orders;
  v_short     record;
  v_coupon_id bigint;
begin
  select * into v_address from public.addresses where id = p_address_id and user_id = v_uid;
  if not found then
    raise exception 'Please choose a delivery address' using errcode = 'P0001', hint = 'address_required';
  end if;

  -- Lock every product in the cart before reading stock.
  perform 1 from public.products p
   where p.id in (select product_id from public.cart_items where user_id = v_uid)
   order by p.id
   for update;

  select p.name, p.stock, c.quantity, p.is_active into v_short
    from public.cart_items c join public.products p on p.id = c.product_id
   where c.user_id = v_uid and (p.stock < c.quantity or not p.is_active)
   limit 1;
  if found then
    raise exception '%', case when not v_short.is_active then format('"%s" is no longer available', v_short.name)
                              else format('Only %s of "%s" left — please update your cart', v_short.stock, v_short.name) end
      using errcode = 'P0001', hint = 'out_of_stock';
  end if;

  v_preview := public.checkout_preview(p_coupon_code, p_points);

  insert into public.orders (user_id, subtotal, discount, points_redeemed, shipping_fee, total,
                             shipping_address, notes, expires_at)
  values (v_uid,
          (v_preview ->> 'subtotal')::numeric,
          (v_preview ->> 'discount')::numeric,
          (v_preview ->> 'points_redeemed')::integer,
          (v_preview ->> 'shipping_fee')::numeric,
          (v_preview ->> 'total')::numeric,
          jsonb_build_object('label', v_address.label, 'recipient', v_address.recipient, 'phone', v_address.phone,
                             'line1', v_address.line1, 'line2', v_address.line2, 'area', v_address.area,
                             'city', v_address.city, 'postal_code', v_address.postal_code),
          nullif(trim(p_notes), ''),
          now() + interval '30 minutes')
  returning * into v_order;

  insert into public.order_items (order_id, product_id, product_name, product_image, unit_price, quantity)
  select v_order.id, p.id, p.name, p.image_url, p.price, c.quantity
    from public.cart_items c join public.products p on p.id = c.product_id
   where c.user_id = v_uid;

  insert into public.inventory_movements (product_id, delta, reason, order_id, note, created_by)
  select oi.product_id, -oi.quantity, 'sale', v_order.id, 'Order ' || v_order.order_number, v_uid
    from public.order_items oi where oi.order_id = v_order.id;

  if v_preview -> 'coupon' is not null and v_preview -> 'coupon' <> 'null'::jsonb then
    select id into v_coupon_id from public.coupons where lower(code::text) = lower(v_preview -> 'coupon' ->> 'code');
    update public.orders set coupon_id = v_coupon_id where id = v_order.id;
    insert into public.coupon_redemptions (coupon_id, order_id, user_id, amount)
    values (v_coupon_id, v_order.id, v_uid, v_order.discount);
  end if;

  if v_order.points_redeemed > 0 then
    insert into public.loyalty_ledger (user_id, delta, reason, order_id, note)
    values (v_uid, -v_order.points_redeemed, 'order_redeemed', v_order.id, 'Redeemed on ' || v_order.order_number);
  end if;

  delete from public.cart_items where user_id = v_uid;

  return public.order_detail(v_order.id);
end;
$$;

create or replace function public.order_detail(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_o public.orders;
begin
  select * into v_o from public.orders where id = p_order_id;
  if not found or (v_o.user_id is distinct from auth.uid() and not public.is_staff()) then
    raise exception 'Order not found' using errcode = 'P0002', hint = 'not_found';
  end if;

  return to_jsonb(v_o) - 'stripe_payment_intent_id' || jsonb_build_object(
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', oi.id, 'product_id', oi.product_id, 'name', oi.product_name, 'image_url', oi.product_image,
                'unit_price', oi.unit_price, 'quantity', oi.quantity, 'line_total', oi.line_total,
                'slug', p.slug) order by oi.id), '[]'::jsonb)
                from public.order_items oi left join public.products p on p.id = oi.product_id
               where oi.order_id = v_o.id),
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object(
                   'status', h.to_status, 'note', h.note, 'at', h.created_at) order by h.created_at), '[]'::jsonb)
                   from public.order_status_history h where h.order_id = v_o.id),
    'coupon_code', (select code from public.coupons where id = v_o.coupon_id),
    'can_cancel', v_o.status in ('pending_payment', 'paid'),
    'can_pay', v_o.status = 'pending_payment' and v_o.expires_at > now(),
    'customer', case when public.is_staff() then
                  (select jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email)
                     from public.profiles p where p.id = v_o.user_id) end);
end;
$$;

create or replace function public.my_orders(p_limit integer default 20, p_offset integer default 0)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'order_number', o.order_number, 'status', o.status, 'total', o.total,
           'placed_at', o.placed_at, 'item_count', (select sum(quantity) from public.order_items where order_id = o.id),
           'thumbnails', (select coalesce(jsonb_agg(oi.product_image), '[]'::jsonb)
                            from (select product_image from public.order_items where order_id = o.id limit 4) oi))
         order by o.placed_at desc), '[]'::jsonb)
    from (select * from public.orders where user_id = auth.uid()
          order by placed_at desc limit p_limit offset p_offset) o;
$$;

-- Customers can cancel before the order is packed. Returns needs_refund=true
-- when Stripe already captured money, so the API can issue the refund.
create or replace function public.cancel_my_order(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_user();
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id and user_id = v_uid for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  if v_order.status not in ('pending_payment', 'paid') then
    raise exception 'This order is already being prepared and can''t be cancelled'
      using errcode = 'P0001', hint = 'invalid_transition';
  end if;

  perform set_config('nishorgo.status_note', coalesce(nullif(trim(p_reason), ''), 'Cancelled by customer'), true);
  update public.orders set status = 'cancelled' where id = p_order_id;

  return public.order_detail(p_order_id) || jsonb_build_object(
    'needs_refund', v_order.status = 'paid' and v_order.stripe_payment_intent_id is not null,
    'payment_intent', case when v_order.status = 'paid' then v_order.stripe_payment_intent_id end);
end;
$$;

-- =============================================================================
-- System functions (called by the API in service mode: Stripe webhooks, cron)
-- =============================================================================
create or replace function private.attach_checkout_session(p_order_id uuid, p_session_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.orders set stripe_checkout_session_id = p_session_id where id = p_order_id;
$$;

create or replace function private.mark_order_paid(p_order_id uuid, p_payment_intent text, p_amount_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order % not found', p_order_id using errcode = 'P0002';
  end if;
  if v_order.status <> 'pending_payment' then
    -- Idempotent: already paid (webhook replay) or cancelled (late payment → caller refunds).
    return jsonb_build_object('status', v_order.status, 'changed', false,
                              'needs_refund', v_order.status = 'cancelled');
  end if;
  if p_amount_cents <> round(v_order.total * 100) then
    raise exception 'Amount mismatch for order %: expected %, got %', v_order.order_number,
      round(v_order.total * 100), p_amount_cents using errcode = 'P0001';
  end if;

  perform set_config('nishorgo.status_note', 'Payment confirmed by Stripe', true);
  update public.orders
     set status = 'paid', stripe_payment_intent_id = p_payment_intent
   where id = p_order_id;
  return jsonb_build_object('status', 'paid', 'changed', true, 'needs_refund', false);
end;
$$;

create or replace function private.expire_stale_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_id    uuid;
begin
  perform set_config('nishorgo.status_note', 'Payment window expired', true);
  for v_id in
    select id from public.orders
     where status = 'pending_payment' and expires_at < now()
     for update skip locked
  loop
    update public.orders set status = 'cancelled' where id = v_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- =============================================================================
-- Admin
-- =============================================================================
create or replace function public.admin_set_order_status(
  p_order_id uuid, p_status public.order_status, p_note text default null, p_tracking_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev public.order_status;
  v_pi   text;
begin
  perform private.require_staff();
  select status, stripe_payment_intent_id into v_prev, v_pi from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  perform set_config('nishorgo.status_note', coalesce(p_note, ''), true);
  update public.orders
     set status = p_status,
         tracking_code = coalesce(nullif(trim(p_tracking_code), ''), tracking_code)
   where id = p_order_id;
  return public.order_detail(p_order_id) || jsonb_build_object(
    'needs_refund', p_status in ('refunded', 'cancelled') and v_prev in ('paid', 'processing', 'shipped', 'delivered')
                    and v_pi is not null,
    'payment_intent', v_pi);
end;
$$;

create or replace function public.restock_product(
  p_product_id bigint, p_delta integer, p_reason public.inventory_reason default 'restock', p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_staff();
begin
  if p_reason in ('sale', 'cancellation', 'initial') then
    raise exception 'Reason % is reserved for the system', p_reason using errcode = 'P0001';
  end if;
  insert into public.inventory_movements (product_id, delta, reason, note, created_by)
  values (p_product_id, p_delta, p_reason, p_note, v_uid);
  return (select jsonb_build_object('id', id, 'stock', stock) from public.products where id = p_product_id);
end;
$$;

-- Create or update a product from a JSON payload. A changed `stock` value is
-- translated into an 'adjustment' ledger entry rather than written directly.
create or replace function public.admin_upsert_product(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_staff();
  v_id      bigint := nullif(p_payload ->> 'id', '')::bigint;
  v_current public.products;
  v_target  integer := nullif(p_payload ->> 'stock', '')::integer;
  v_product public.products;
  v_cat     smallint;
begin
  select id into v_cat from public.categories
   where slug = p_payload ->> 'category' or id::text = p_payload ->> 'category_id';
  if v_cat is null and v_id is null then
    raise exception 'Choose a category' using errcode = 'P0001', hint = 'validation';
  end if;

  if v_id is null then
    insert into public.products (
      name, scientific_name, category_id, short_description, description, price, compare_at_price,
      stock, low_stock_threshold, image_url, gallery, light, difficulty, water_every_days,
      fertilize_every_days, pet_friendly, air_purifying, edible, mature_height_cm, tags, is_active, is_featured)
    values (
      p_payload ->> 'name', p_payload ->> 'scientific_name', v_cat, p_payload ->> 'short_description',
      p_payload ->> 'description', (p_payload ->> 'price')::numeric, nullif(p_payload ->> 'compare_at_price', '')::numeric,
      coalesce(v_target, 0), coalesce((p_payload ->> 'low_stock_threshold')::integer, 5), p_payload ->> 'image_url',
      coalesce(array(select jsonb_array_elements_text(p_payload -> 'gallery')), '{}'),
      coalesce((p_payload ->> 'light')::public.light_level, 'bright_indirect'),
      coalesce((p_payload ->> 'difficulty')::public.care_difficulty, 'easy'),
      coalesce((p_payload ->> 'water_every_days')::smallint, 3),
      nullif(p_payload ->> 'fertilize_every_days', '')::smallint,
      coalesce((p_payload ->> 'pet_friendly')::boolean, false),
      coalesce((p_payload ->> 'air_purifying')::boolean, false),
      coalesce((p_payload ->> 'edible')::boolean, false),
      nullif(p_payload ->> 'mature_height_cm', '')::smallint,
      coalesce(array(select jsonb_array_elements_text(p_payload -> 'tags')), '{}'),
      coalesce((p_payload ->> 'is_active')::boolean, true),
      coalesce((p_payload ->> 'is_featured')::boolean, false))
    returning * into v_product;
  else
    select * into v_current from public.products where id = v_id for update;
    if not found then
      raise exception 'Product not found' using errcode = 'P0002', hint = 'not_found';
    end if;
    update public.products set
      name                 = coalesce(p_payload ->> 'name', name),
      slug                 = case when p_payload ? 'slug' then p_payload ->> 'slug' else slug end,
      scientific_name      = case when p_payload ? 'scientific_name' then p_payload ->> 'scientific_name' else scientific_name end,
      category_id          = coalesce(v_cat, category_id),
      short_description    = case when p_payload ? 'short_description' then p_payload ->> 'short_description' else short_description end,
      description          = case when p_payload ? 'description' then p_payload ->> 'description' else description end,
      price                = coalesce((p_payload ->> 'price')::numeric, price),
      compare_at_price     = case when p_payload ? 'compare_at_price' then nullif(p_payload ->> 'compare_at_price', '')::numeric else compare_at_price end,
      low_stock_threshold  = coalesce((p_payload ->> 'low_stock_threshold')::integer, low_stock_threshold),
      image_url            = case when p_payload ? 'image_url' then p_payload ->> 'image_url' else image_url end,
      gallery              = case when p_payload ? 'gallery' then array(select jsonb_array_elements_text(p_payload -> 'gallery')) else gallery end,
      light                = coalesce((p_payload ->> 'light')::public.light_level, light),
      difficulty           = coalesce((p_payload ->> 'difficulty')::public.care_difficulty, difficulty),
      water_every_days     = coalesce((p_payload ->> 'water_every_days')::smallint, water_every_days),
      fertilize_every_days = case when p_payload ? 'fertilize_every_days' then nullif(p_payload ->> 'fertilize_every_days', '')::smallint else fertilize_every_days end,
      pet_friendly         = coalesce((p_payload ->> 'pet_friendly')::boolean, pet_friendly),
      air_purifying        = coalesce((p_payload ->> 'air_purifying')::boolean, air_purifying),
      edible               = coalesce((p_payload ->> 'edible')::boolean, edible),
      mature_height_cm     = case when p_payload ? 'mature_height_cm' then nullif(p_payload ->> 'mature_height_cm', '')::smallint else mature_height_cm end,
      tags                 = case when p_payload ? 'tags' then array(select jsonb_array_elements_text(p_payload -> 'tags')) else tags end,
      is_active            = coalesce((p_payload ->> 'is_active')::boolean, is_active),
      is_featured          = coalesce((p_payload ->> 'is_featured')::boolean, is_featured)
    where id = v_id
    returning * into v_product;

    if v_target is not null and v_target <> v_current.stock then
      insert into public.inventory_movements (product_id, delta, reason, note, created_by)
      values (v_id, v_target - v_current.stock, 'adjustment', 'Edited in admin', v_uid);
    end if;
  end if;

  select * into v_product from public.products where id = v_product.id;
  return private.product_card(v_product) || to_jsonb(v_product) - 'search_vector';
end;
$$;

-- =============================================================================
-- Notifications
-- =============================================================================
create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns integer
language sql
set search_path = ''
as $$
  with updated as (
    update public.notifications
       set read_at = now()
     where user_id = auth.uid() and read_at is null
       and (p_ids is null or id = any (p_ids))
    returning 1)
  select count(*)::integer from updated;
$$;

-- =============================================================================
-- My Garden
-- =============================================================================

-- Next-due computations shared by the garden overview and the reminder job.
-- Calendar days in Asia/Dhaka: 0 = due today, -1 = a day overdue.
create or replace function private.plant_schedule(g public.garden_plants)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with due as (
    select coalesce((g.last_watered_at at time zone 'Asia/Dhaka')::date, g.acquired_on) + g.water_every_days as next_water_on,
           case when g.fertilize_every_days is not null then
             coalesce((g.last_fertilized_at at time zone 'Asia/Dhaka')::date, g.acquired_on) + g.fertilize_every_days
           end as next_feed_on,
           (now() at time zone 'Asia/Dhaka')::date as today
  )
  select jsonb_build_object(
    'next_water_at', d.next_water_on,
    'water_due_in_days', d.next_water_on - d.today,
    'next_fertilize_at', d.next_feed_on,
    'fertilize_due_in_days', d.next_feed_on - d.today,
    -- Health: 100 on schedule, −15 per day overdue on water, −5 per day on fertiliser.
    'health', greatest(0, 100
                - 15 * greatest(0, d.today - d.next_water_on)
                - 5 * greatest(0, coalesce(d.today - d.next_feed_on, 0))))
  from due d;
$$;

create or replace function public.garden_overview()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'plants', (select coalesce(jsonb_agg(to_jsonb(g) || private.plant_schedule(g) || jsonb_build_object(
                         'product_slug', p.slug,
                         'recent_care', (select coalesce(jsonb_agg(jsonb_build_object('task', l.task, 'at', l.done_at, 'note', l.note)
                                                                   order by l.done_at desc), '[]'::jsonb)
                                           from (select * from public.care_logs where plant_id = g.id
                                                 order by done_at desc limit 5) l))
                       order by (private.plant_schedule(g) ->> 'water_due_in_days')::int, g.created_at), '[]'::jsonb)
                 from public.garden_plants g
                 left join public.products p on p.id = g.product_id
                where g.user_id = v_uid and not g.is_archived),
    'streak', (select jsonb_build_object('current',
                         case when last_care_on >= (now() at time zone 'Asia/Dhaka')::date - 1 then care_streak else 0 end,
                         'best', best_care_streak, 'last_care_on', last_care_on)
                 from public.profiles where id = v_uid),
    'week', (select jsonb_build_object('tasks_done', count(*),
                                       'days_active', count(distinct (done_at at time zone 'Asia/Dhaka')::date))
               from public.care_logs where user_id = v_uid and done_at > now() - interval '7 days'));
end;
$$;

create or replace function public.log_care(p_plant_id bigint, p_task public.care_task, p_note text default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_g   public.garden_plants;
begin
  insert into public.care_logs (plant_id, user_id, task, note) values (p_plant_id, v_uid, p_task, p_note);
  select * into v_g from public.garden_plants where id = p_plant_id;
  return to_jsonb(v_g) || private.plant_schedule(v_g);
end;
$$;

-- =============================================================================
-- Account
-- =============================================================================
create or replace function public.account_summary()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_p   public.profiles;
  v_tier text;
  v_next integer;
begin
  select * into v_p from public.profiles where id = v_uid;
  v_tier := public.loyalty_tier(v_p.lifetime_points);
  v_next := case v_tier when 'Seedling' then 500 when 'Sprout' then 2000 when 'Bloom' then 5000 end;
  return to_jsonb(v_p) || jsonb_build_object(
    'tier', v_tier,
    'next_tier_at', v_next,
    'next_tier_progress', case when v_next is null then 100 else round(v_p.lifetime_points * 100.0 / v_next) end,
    'orders_count', (select count(*) from public.orders where user_id = v_uid and status <> 'cancelled'),
    'total_spent', (select coalesce(sum(total), 0) from public.orders where user_id = v_uid
                     and status in ('paid', 'processing', 'shipped', 'delivered')),
    'garden_count', (select count(*) from public.garden_plants where user_id = v_uid and not is_archived),
    'wishlist_count', (select count(*) from public.wishlist_items where user_id = v_uid),
    'unread_notifications', (select count(*) from public.notifications where user_id = v_uid and read_at is null),
    'points_history', (select coalesce(jsonb_agg(jsonb_build_object('delta', delta, 'reason', reason, 'note', note, 'at', created_at)
                                                 order by created_at desc), '[]'::jsonb)
                         from (select * from public.loyalty_ledger where user_id = v_uid
                               order by created_at desc limit 20) l));
end;
$$;
