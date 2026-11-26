-- =============================================================================
-- Nishorgo 2.0 · pgTAP test-suite
-- Run with:  supabase test db        (or psql -f this file against a seeded DB)
-- Everything runs inside a transaction and is rolled back.
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(43);

-- ---------------------------------------------------------------- fixtures
create or replace function pg_temp.new_user(p_email text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated', p_email, '', now(),
          jsonb_build_object('full_name', split_part(p_email, '@', 1)), now(), now());
  return v;
end $$;

create or replace function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create temp table t (k text primary key, v text);
grant all on t to authenticated, anon;
grant execute on all functions in schema pg_temp to authenticated, anon;

insert into t values ('alice', pg_temp.new_user('alice@test.local')),
                     ('bob',   pg_temp.new_user('bob@test.local')),
                     ('staff', pg_temp.new_user('staff@test.local'));
update profiles set role = 'staff' where id = (select v::uuid from t where k = 'staff');

insert into categories (slug, name) values ('test-cat', 'Test Category') on conflict do nothing;
insert into products (name, category_id, price, stock, low_stock_threshold)
select 'Test Fern', id, 100, 5, 2 from categories where slug = 'test-cat';
insert into t select 'fern', id::text from products where name = 'Test Fern';
insert into addresses (user_id, recipient, phone, line1, city)
select v::uuid, 'Alice', '+8801700000000', 'Road 1', 'Dhaka' from t where k = 'alice';
insert into t select 'alice_addr', id::text from addresses where user_id = (select v::uuid from t where k = 'alice');
insert into coupons (code, kind, value, min_subtotal, per_user_limit) values ('TESTTEN', 'percent', 10, 0, 1);

-- ---------------------------------------------------------- signup trigger
select is((select count(*)::int from profiles where id = (select v::uuid from t where k = 'alice')), 1,
          'signup creates a profile');
select is((select loyalty_points from profiles where id = (select v::uuid from t where k = 'alice')), 100,
          'signup awards 100 welcome points');
select is((select stock from products where id = (select v::bigint from t where k = 'fern')), 5,
          'opening stock goes through the ledger');
select is((select count(*)::int from inventory_movements where product_id = (select v::bigint from t where k = 'fern')), 1,
          'opening stock creates one initial movement');
select is((select slug from products where name = 'Test Fern'), 'test-fern', 'slug is generated');

-- ---------------------------------------------------------------- anon
set local role anon;
select isnt_empty($$ select 1 from products $$, 'anon can browse products');
select throws_ok($$ select 1 from orders $$, '42501', null, 'anon has no access to orders');
select throws_ok($$ select * from profiles $$, '42501', null, 'anon cannot read profiles');
select ok((search_products('fern') -> 'total')::int >= 1, 'anon can search');
select ok((search_products('fernn') -> 'total')::int >= 1, 'fuzzy search tolerates typos');
reset role;

-- ------------------------------------------------------------------- alice
select pg_temp.login((select v::uuid from t where k = 'alice'));

select throws_ok($$ update profiles set role = 'admin' where id = auth.uid() $$,
                 '42501', null, 'customer cannot promote themselves');
select throws_ok($$ update profiles set loyalty_points = 99999 where id = auth.uid() $$,
                 '42501', null, 'customer cannot mint points');
select lives_ok($$ update profiles set full_name = 'Alice A.' where id = auth.uid() $$,
                'customer can edit their own name');
select is_empty($$ update products set price = 1 returning 1 $$, 'customer cannot update products (RLS filters every row)');
select throws_ok($$ insert into orders (user_id, subtotal, total, shipping_address)
                   values (auth.uid(), 1, 1, '{}') $$, '42501', null, 'orders cannot be inserted directly');

select throws_ok(format('select cart_upsert(%s, 6)', (select v from t where k = 'fern')),
                 'P0001', null, 'cannot add more than available stock to cart');
select lives_ok(format('select cart_upsert(%s, 3)', (select v from t where k = 'fern')), 'add 3 to cart');
select is((cart_summary() ->> 'subtotal')::numeric, 300::numeric, 'cart subtotal');
select is((select stock from products where id = (select v::bigint from t where k = 'fern')), 5,
          'adding to cart does NOT reserve stock (legacy bug fixed)');
select is((checkout_preview('TESTTEN', 0) ->> 'discount')::numeric, 30::numeric, 'coupon preview: 10% off');
select is((checkout_preview(null, 1000) ->> 'points_redeemed')::int, 60, 'points capped at 20% of subtotal');

insert into t select 'order1', (place_order((select v::bigint from t where k = 'alice_addr'), 'TESTTEN', 20) ->> 'id');
select is((select status::text from orders where id = (select v::uuid from t where k = 'order1')), 'pending_payment',
          'order starts pending payment');
select is((select total from orders where id = (select v::uuid from t where k = 'order1')), 300 - 30 - 20 + 60::numeric,
          'order total = subtotal - coupon - points + shipping');
select is((select stock from products where id = (select v::bigint from t where k = 'fern')), 2,
          'placing the order commits stock');
select is((select count(*)::int from cart_items where user_id = auth.uid()), 0, 'cart is emptied');
select is((select loyalty_points from profiles where id = auth.uid()), 80, 'redeemed points deducted');
select is((select count(*)::int from coupon_redemptions where user_id = auth.uid()), 1, 'coupon redemption recorded');
select throws_ok(format('select cart_upsert(%s, 1); select place_order(%s, %L, 0)',
                        (select v from t where k = 'fern'), (select v from t where k = 'alice_addr'), 'TESTTEN'),
                 'P0001', null, 'coupon per-user limit enforced');
select cart_clear();

select lives_ok(format('select cancel_my_order(%L)', (select v from t where k = 'order1')), 'customer cancels');
select is((select stock from products where id = (select v::bigint from t where k = 'fern')), 5,
          'cancellation returns stock');
select is((select loyalty_points from profiles where id = auth.uid()), 100, 'cancellation refunds points');
select is((select count(*)::int from coupon_redemptions where user_id = auth.uid()), 0, 'cancellation releases the coupon');
select is((select array_agg(to_status::text order by id) from order_status_history
            where order_id = (select v::uuid from t where k = 'order1')),
          array['pending_payment', 'cancelled'], 'status history recorded by trigger');

select lives_ok(format('select submit_review(%s, 5::smallint, %L)', (select v from t where k = 'fern'), 'Lovely'),
                'anyone signed in can review');
select is((select is_verified_purchase from reviews where user_id = auth.uid()), false,
          'not verified without a delivered order');
select is((select rating_avg from products where id = (select v::bigint from t where k = 'fern')), 5.0,
          'product rating recomputed by trigger');
select throws_ok(format('select toggle_review_vote(%s)', (select id from reviews where user_id = auth.uid())),
                 'P0001', null, 'cannot upvote your own review');

select pg_temp.logout();

-- --------------------------------------------------------------------- bob
select pg_temp.login((select v::uuid from t where k = 'bob'));
select is_empty(format('select 1 from orders where id = %L', (select v from t where k = 'order1')),
                'bob cannot see alice''s orders');
select throws_ok(format('select order_detail(%L)', (select v from t where k = 'order1')),
                 'P0002', null, 'bob cannot fetch alice''s order through the API');
select pg_temp.logout();

-- ---------------------------------------------------------- state machine
select throws_ok(format('update orders set status = ''delivered'' where id = %L', (select v from t where k = 'order1')),
                 'P0001', null, 'cancelled → delivered is rejected');

-- ------------------------------------------------------------------- chat
select pg_temp.login((select v::uuid from t where k = 'alice'));
insert into t select 'room', (open_support_chat(null, 'help!') ->> 'id');
select pg_temp.logout();
select pg_temp.login((select v::uuid from t where k = 'bob'));
select is_empty(format('select 1 from chat_messages where room_id = %L', (select v from t where k = 'room')),
                'other customers cannot read a support chat');
select pg_temp.logout();
select pg_temp.login((select v::uuid from t where k = 'staff'));
select isnt_empty(format('select 1 from chat_messages where room_id = %L', (select v from t where k = 'room')),
                  'staff can read support chats');
select pg_temp.logout();

-- ---------------------------------------------------------- JWT role hook
select is(custom_access_token_hook(jsonb_build_object('user_id', (select v from t where k = 'staff'),
                                                      'claims', '{}'::jsonb)) -> 'claims' ->> 'user_role',
          'staff', 'access-token hook stamps user_role');

select * from finish();
rollback;
