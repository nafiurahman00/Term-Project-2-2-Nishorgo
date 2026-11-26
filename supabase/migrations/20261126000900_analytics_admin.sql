-- =============================================================================
-- Nishorgo 2.0 · 09 · Analytics & admin console
-- A materialized daily-sales cube (refreshed by pg_cron), a single-call admin
-- dashboard with period-over-period KPIs, and admin listing functions.
-- =============================================================================

create materialized view public.mv_daily_sales as
select (o.paid_at at time zone 'Asia/Dhaka')::date        as day,
       count(distinct o.id)                               as orders,
       sum(o.total)                                       as revenue,
       sum(o.discount + o.points_redeemed)                as discounts,
       count(distinct o.user_id)                          as customers,
       coalesce(sum(i.units), 0)::bigint                  as units
  from public.orders o
  cross join lateral (select sum(oi.quantity) as units
                        from public.order_items oi where oi.order_id = o.id) i
 where o.status in ('paid', 'processing', 'shipped', 'delivered')
   and o.paid_at is not null
 group by 1
with data;

create unique index mv_daily_sales_day_idx on public.mv_daily_sales (day);
revoke all on public.mv_daily_sales from public, anon, authenticated;

create or replace function private.refresh_analytics()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view concurrently public.mv_daily_sales;
end;
$$;

create or replace function public.admin_refresh_analytics()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  perform private.refresh_analytics();
end;
$$;

-- Everything the admin home screen needs, in one round trip.
create or replace function public.admin_dashboard(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days  integer := least(greatest(p_days, 7), 365);
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_from  date := v_today - (v_days - 1);
  v_pfrom date := v_from - v_days;
  v_cur   record;
  v_prev  record;
  v_paid  public.order_status[] := array['paid', 'processing', 'shipped', 'delivered']::public.order_status[];
begin
  perform private.require_staff();

  select coalesce(sum(revenue), 0) as revenue, coalesce(sum(orders), 0) as orders,
         coalesce(sum(units), 0) as units, coalesce(sum(discounts), 0) as discounts
    into v_cur from public.mv_daily_sales where day between v_from and v_today;
  select coalesce(sum(revenue), 0) as revenue, coalesce(sum(orders), 0) as orders,
         coalesce(sum(units), 0) as units, coalesce(sum(discounts), 0) as discounts
    into v_prev from public.mv_daily_sales where day between v_pfrom and v_from - 1;

  return jsonb_build_object(
    'period', jsonb_build_object('days', v_days, 'from', v_from, 'to', v_today,
                                 'refreshed_at', now()),
    'kpis', jsonb_build_object(
      'revenue',   jsonb_build_object('value', v_cur.revenue, 'previous', v_prev.revenue),
      'orders',    jsonb_build_object('value', v_cur.orders, 'previous', v_prev.orders),
      'aov',       jsonb_build_object('value', round(v_cur.revenue / nullif(v_cur.orders, 0), 2),
                                      'previous', round(v_prev.revenue / nullif(v_prev.orders, 0), 2)),
      'units',     jsonb_build_object('value', v_cur.units, 'previous', v_prev.units),
      'customers', jsonb_build_object(
                     'value', (select count(*) from public.profiles where created_at::date between v_from and v_today),
                     'previous', (select count(*) from public.profiles where created_at::date between v_pfrom and v_from - 1)),
      'pending_fulfilment', (select count(*) from public.orders where status in ('paid', 'processing'))),
    'revenue_series', (
      select jsonb_agg(jsonb_build_object('day', d.day, 'revenue', coalesce(m.revenue, 0),
                                          'orders', coalesce(m.orders, 0)) order by d.day)
        from generate_series(v_from, v_today, interval '1 day') as d(day)
        left join public.mv_daily_sales m on m.day = d.day::date),
    'category_breakdown', (
      select coalesce(jsonb_agg(jsonb_build_object('category', x.name, 'emoji', x.emoji,
                                                   'revenue', x.revenue, 'units', x.units)
                                order by x.revenue desc), '[]'::jsonb)
        from (select c.name, c.emoji, sum(oi.line_total) as revenue, sum(oi.quantity) as units
                from public.order_items oi
                join public.orders o on o.id = oi.order_id and o.status = any (v_paid)
                join public.products p on p.id = oi.product_id
                join public.categories c on c.id = p.category_id
               where (o.paid_at at time zone 'Asia/Dhaka')::date between v_from and v_today
               group by c.name, c.emoji) x),
    'top_products', (
      select coalesce(jsonb_agg(x order by x.revenue desc), '[]'::jsonb)
        from (select p.id, p.name, p.slug, p.image_url, p.stock, p.rating_avg,
                     sum(oi.quantity) as units, sum(oi.line_total) as revenue
                from public.order_items oi
                join public.orders o on o.id = oi.order_id and o.status = any (v_paid)
                join public.products p on p.id = oi.product_id
               where (o.paid_at at time zone 'Asia/Dhaka')::date between v_from and v_today
               group by p.id
               order by revenue desc
               limit 5) x),
    'status_counts', (
      select jsonb_object_agg(s.status, coalesce(c.cnt, 0))
        from unnest(enum_range(null::public.order_status)) as s(status)
        left join (select status, count(*) cnt from public.orders
                    where placed_at::date between v_from and v_today group by status) c on c.status = s.status),
    'order_heatmap', (
      -- orders by weekday × hour (Dhaka time): when do people shop?
      select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'orders', cnt)), '[]'::jsonb)
        from (select extract(isodow from placed_at at time zone 'Asia/Dhaka')::int as dow,
                     extract(hour from placed_at at time zone 'Asia/Dhaka')::int as hr,
                     count(*) as cnt
                from public.orders
               where status = any (v_paid) and placed_at::date between v_from and v_today
               group by 1, 2) h),
    'low_stock', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'slug', slug, 'stock', stock,
                                                   'threshold', low_stock_threshold, 'image_url', image_url,
                                                   'wishlist_count', wishlist_count)
                                order by stock, wishlist_count desc), '[]'::jsonb)
        from public.products where is_active and stock <= low_stock_threshold),
    'recent_orders', (
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'order_number', o.order_number, 'status', o.status,
                                                   'total', o.total, 'placed_at', o.placed_at,
                                                   'customer', p.full_name) order by o.placed_at desc), '[]'::jsonb)
        from (select * from public.orders order by placed_at desc limit 8) o
        join public.profiles p on p.id = o.user_id),
    'coupon_performance', (
      select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'uses', c.times_used,
                                                   'discount_given', coalesce(r.amount, 0),
                                                   'revenue', coalesce(r.revenue, 0)) order by c.times_used desc), '[]'::jsonb)
        from public.coupons c
        left join (select cr.coupon_id, sum(cr.amount) amount, sum(o.total) revenue
                     from public.coupon_redemptions cr join public.orders o on o.id = cr.order_id
                    group by cr.coupon_id) r on r.coupon_id = c.id));
end;
$$;

create or replace function public.admin_list_orders(
  p_status public.order_status default null, p_query text default null,
  p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  return (
    with filtered as (
      select o.*, p.full_name, p.email
        from public.orders o
        join public.profiles p on p.id = o.user_id
       where (p_status is null or o.status = p_status)
         and (nullif(trim(p_query), '') is null
              or o.order_number ilike '%' || trim(p_query) || '%'
              or p.full_name ilike '%' || trim(p_query) || '%'
              or p.email::text ilike '%' || trim(p_query) || '%')
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', f.id, 'order_number', f.order_number, 'status', f.status, 'total', f.total,
                 'placed_at', f.placed_at, 'paid_at', f.paid_at, 'tracking_code', f.tracking_code,
                 'customer', jsonb_build_object('name', f.full_name, 'email', f.email),
                 'city', f.shipping_address ->> 'city',
                 'item_count', (select sum(quantity) from public.order_items where order_id = f.id),
                 'next_statuses', (select coalesce(jsonb_agg(s), '[]'::jsonb)
                                     from unnest(enum_range(null::public.order_status)) s
                                    where public.order_transition_allowed(f.status, s)))
               order by f.placed_at desc)
          from (select * from filtered order by placed_at desc
                limit least(p_limit, 100) offset p_offset) f), '[]'::jsonb)));
end;
$$;

create or replace function public.admin_list_products(
  p_query text default null, p_category text default null, p_stock text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  return (
    with filtered as (
      select p.*
        from public.products p
        join public.categories c on c.id = p.category_id
       where (p_category is null or c.slug = p_category)
         and (nullif(trim(p_query), '') is null or p.name ilike '%' || trim(p_query) || '%')
         and (p_stock is null
              or (p_stock = 'out' and p.stock = 0)
              or (p_stock = 'low' and p.stock <= p.low_stock_threshold)
              or (p_stock = 'inactive' and not p.is_active))
    )
    select jsonb_build_object(
      'total', (select count(*) from filtered),
      'items', coalesce((
        select jsonb_agg(private.product_card(f::public.products) || jsonb_build_object(
                 'is_active', f.is_active, 'low_stock_threshold', f.low_stock_threshold,
                 'wishlist_count', f.wishlist_count, 'updated_at', f.updated_at,
                 'stock_30d', (select coalesce(jsonb_agg(jsonb_build_object('at', m.created_at, 'delta', m.delta,
                                                                            'reason', m.reason) order by m.created_at), '[]'::jsonb)
                                 from public.inventory_movements m
                                where m.product_id = f.id and m.created_at > now() - interval '30 days'))
               order by f.updated_at desc)
          from (select * from filtered order by updated_at desc
                limit least(p_limit, 200) offset p_offset) f), '[]'::jsonb)));
end;
$$;

create or replace function public.admin_product_inventory(p_product_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_staff() then (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', m.id, 'delta', m.delta, 'reason', m.reason, 'note', m.note, 'at', m.created_at,
             'balance', m.balance, 'by', pr.full_name, 'order_id', m.order_id) order by m.id desc), '[]'::jsonb)
      from (select mv.*, sum(mv.delta) over (order by mv.id) as balance
              from public.inventory_movements mv where mv.product_id = p_product_id) m
      left join public.profiles pr on pr.id = m.created_by)
  end;
$$;

create or replace function public.admin_list_customers(
  p_query text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  return (
    with c as (
      select p.id, p.full_name, p.email, p.role, p.avatar_url, p.loyalty_points, p.lifetime_points, p.created_at,
             public.loyalty_tier(p.lifetime_points) as tier,
             count(o.id) filter (where o.status in ('paid', 'processing', 'shipped', 'delivered')) as orders,
             coalesce(sum(o.total) filter (where o.status in ('paid', 'processing', 'shipped', 'delivered')), 0) as lifetime_value,
             max(o.placed_at) as last_order_at
        from public.profiles p
        left join public.orders o on o.user_id = p.id
       where nullif(trim(p_query), '') is null
          or p.full_name ilike '%' || trim(p_query) || '%'
          or p.email::text ilike '%' || trim(p_query) || '%'
       group by p.id
    )
    select jsonb_build_object(
      'total', (select count(*) from c),
      'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.lifetime_value desc, x.created_at desc)
                           from (select * from c order by lifetime_value desc, created_at desc
                                 limit least(p_limit, 100) offset p_offset) x), '[]'::jsonb)));
end;
$$;

create or replace function public.admin_set_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501', hint = 'forbidden';
  end if;
  if p_user_id = auth.uid() and p_role <> 'admin' then
    raise exception 'You cannot demote yourself' using errcode = 'P0001';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
end;
$$;

create or replace function public.admin_audit_log(
  p_table text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  return (
    select jsonb_build_object(
      'total', (select count(*) from public.audit_log where p_table is null or table_name = p_table),
      'items', coalesce(jsonb_agg(jsonb_build_object(
                 'id', a.id, 'table', a.table_name, 'record_id', a.record_id, 'action', a.action,
                 'actor', coalesce(p.full_name, 'System'), 'actor_role', a.actor_role,
                 'changed_fields', a.changed_fields,
                 'diff', case when a.action = 'UPDATE' then (
                           select jsonb_object_agg(f, jsonb_build_object('from', a.old_data -> f, 'to', a.new_data -> f))
                             from unnest(a.changed_fields) f) end,
                 'snapshot', case when a.action <> 'UPDATE' then coalesce(a.new_data, a.old_data) end,
                 'at', a.created_at) order by a.id desc), '[]'::jsonb))
      from (select * from public.audit_log
             where p_table is null or table_name = p_table
             order by id desc limit least(p_limit, 200) offset p_offset) a
      left join public.profiles p on p.id = a.actor_id);
end;
$$;

create or replace function public.admin_upsert_coupon(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.coupons;
begin
  perform private.require_staff();
  insert into public.coupons (code, description, kind, value, min_subtotal, max_discount,
                              starts_at, ends_at, usage_limit, per_user_limit, is_active)
  values (upper(p_payload ->> 'code'), p_payload ->> 'description',
          (p_payload ->> 'kind')::public.discount_kind, (p_payload ->> 'value')::numeric,
          coalesce((p_payload ->> 'min_subtotal')::numeric, 0), nullif(p_payload ->> 'max_discount', '')::numeric,
          coalesce((p_payload ->> 'starts_at')::timestamptz, now()), nullif(p_payload ->> 'ends_at', '')::timestamptz,
          nullif(p_payload ->> 'usage_limit', '')::integer, coalesce((p_payload ->> 'per_user_limit')::integer, 1),
          coalesce((p_payload ->> 'is_active')::boolean, true))
  on conflict (code) do update set
    description = excluded.description, kind = excluded.kind, value = excluded.value,
    min_subtotal = excluded.min_subtotal, max_discount = excluded.max_discount,
    starts_at = excluded.starts_at, ends_at = excluded.ends_at, usage_limit = excluded.usage_limit,
    per_user_limit = excluded.per_user_limit, is_active = excluded.is_active
  returning * into v_c;
  return to_jsonb(v_c);
end;
$$;

create or replace function public.admin_list_coupons()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_staff() then
    coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object(
                'is_live', c.is_active and now() between c.starts_at and coalesce(c.ends_at, 'infinity')
                           and (c.usage_limit is null or c.times_used < c.usage_limit))
              order by c.created_at desc) from public.coupons c), '[]'::jsonb)
  end;
$$;
