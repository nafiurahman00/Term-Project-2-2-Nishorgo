-- =============================================================================
-- Nishorgo 2.0 · 07 · Audit trail & product alerts
-- A generic row-level audit trigger (who changed what, with a column diff),
-- plus product watchers: low-stock alerts for staff, back-in-stock and
-- price-drop alerts for everyone who wishlisted the plant.
-- =============================================================================

create table public.audit_log (
  id              bigint generated always as identity primary key,
  table_name      text not null,
  record_id       text not null,
  action          text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id        uuid,
  actor_role      text,
  changed_fields  text[],
  old_data        jsonb,
  new_data        jsonb,
  created_at      timestamptz not null default now()
);
create index audit_log_table_record_idx on public.audit_log (table_name, record_id, created_at desc);
create index audit_log_created_idx      on public.audit_log (created_at desc);
create index audit_log_actor_idx        on public.audit_log (actor_id, created_at desc);

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  -- Trigger-maintained aggregates are excluded: stock has its own ledger.
  v_ignore  text[] := array['updated_at', 'search_vector', 'stock', 'sold_count', 'wishlist_count',
                            'rating_avg', 'rating_count', 'times_used'];
  v_changed text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key)
      into v_changed
      from jsonb_each(v_new) n
     where not (n.key = any (v_ignore))
       and n.value is distinct from v_old -> n.key;
    if v_changed is null then
      return null;   -- nothing meaningful changed (e.g. only updated_at)
    end if;
  end if;

  insert into public.audit_log (table_name, record_id, action, actor_id, actor_role,
                                changed_fields, old_data, new_data)
  values (tg_table_name,
          coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'code', v_old ->> 'code'),
          tg_op,
          auth.uid(),
          coalesce((select p.role::text from public.profiles p where p.id = auth.uid()), 'system'),
          v_changed,
          v_old - v_ignore,
          v_new - v_ignore);
  return null;
end;
$$;

create trigger audit_products   after insert or update or delete on public.products
  for each row execute function private.audit_row_change();
create trigger audit_categories after insert or update or delete on public.categories
  for each row execute function private.audit_row_change();
create trigger audit_coupons    after insert or update or delete on public.coupons
  for each row execute function private.audit_row_change();
create trigger audit_orders     after update or delete on public.orders
  for each row execute function private.audit_row_change();
create trigger audit_profiles_role after update of role on public.profiles
  for each row execute function private.audit_row_change();

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function private.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Product watchers
-- -----------------------------------------------------------------------------
create or replace function private.products_watch_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link text := '/plants/' || new.slug;
begin
  -- Low stock: fire once when crossing the threshold downward.
  if new.stock <= new.low_stock_threshold and old.stock > old.low_stock_threshold then
    perform private.notify_staff('stock',
      case when new.stock = 0 then 'Sold out: ' || new.name else 'Low stock: ' || new.name end,
      format('%s left (threshold %s)', new.stock, new.low_stock_threshold),
      '/admin/products?focus=' || new.id,
      jsonb_build_object('product_id', new.id, 'stock', new.stock));
  end if;

  -- Back in stock: everyone who wishlisted it.
  if old.stock = 0 and new.stock > 0 and new.is_active then
    insert into public.notifications (user_id, kind, title, body, link, data)
    select w.user_id, 'stock', new.name || ' is back in stock 🌱',
           format('%s available now — grab yours before it''s gone.', new.stock),
           v_link, jsonb_build_object('product_id', new.id)
      from public.wishlist_items w
     where w.product_id = new.id;
  end if;

  -- Price drop: notify wishlisters when price falls below what they saw.
  if new.price < old.price and new.is_active then
    insert into public.notifications (user_id, kind, title, body, link, data)
    select w.user_id, 'price_drop', 'Price drop on ' || new.name,
           format('Now ৳%s (was ৳%s) — %s%% off.', new.price, old.price,
                  round((1 - new.price / old.price) * 100)),
           v_link, jsonb_build_object('product_id', new.id, 'old_price', old.price, 'new_price', new.price)
      from public.wishlist_items w
     where w.product_id = new.id;
  end if;
  return null;
end;
$$;

create trigger products_watch_changes
  after update of stock, price on public.products
  for each row execute function private.products_watch_changes();
