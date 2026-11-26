-- =============================================================================
-- Nishorgo 2.0 · DEMO data (development / showcase only — do NOT run in prod)
--
-- Creates demo accounts and ~90 days of realistic history by driving the real
-- business functions (place_order, mark_order_paid, status transitions,
-- reviews, care logs, chat). Then back-dates timestamps so the analytics
-- dashboard has a meaningful trend line.
--
--   admin@nishorgo.test   / Nishorgo#2026   (admin)
--   expert@nishorgo.test  / Nishorgo#2026   (staff — answers support chat)
--   ayesha@nishorgo.test  / Nishorgo#2026   (customer, plus 7 more)
-- =============================================================================

do $$
declare
  v_people   jsonb := '[
    {"email":"admin@nishorgo.test",  "name":"Nishorgo Admin",  "role":"admin", "city":"Dhaka"},
    {"email":"expert@nishorgo.test", "name":"Rafi Ahmed",      "role":"staff", "city":"Dhaka"},
    {"email":"ayesha@nishorgo.test", "name":"Ayesha Siddika",  "role":"customer", "city":"Dhaka"},
    {"email":"tanvir@nishorgo.test", "name":"Tanvir Hasan",    "role":"customer", "city":"Chattogram"},
    {"email":"rumana@nishorgo.test", "name":"Rumana Akter",    "role":"customer", "city":"Sylhet"},
    {"email":"farhan@nishorgo.test", "name":"Farhan Kabir",    "role":"customer", "city":"Dhaka"},
    {"email":"nusrat@nishorgo.test", "name":"Nusrat Jahan",    "role":"customer", "city":"Rajshahi"},
    {"email":"arif@nishorgo.test",   "name":"Arif Chowdhury",  "role":"customer", "city":"Khulna"},
    {"email":"sadia@nishorgo.test",  "name":"Sadia Islam",     "role":"customer", "city":"Dhaka"},
    {"email":"imran@nishorgo.test",  "name":"Imran Hossain",   "role":"customer", "city":"Chattogram"}
  ]'::jsonb;
  v_person   jsonb;
  v_uid      uuid;
  v_customers uuid[] := '{}';
  v_products bigint[];
  v_order    jsonb;
  v_oid      uuid;
  v_addr     bigint;
  v_age      integer;
  v_pid      bigint;
  v_qty      integer;
  v_i        integer;
  v_j        integer;
  v_coupon   text;
  v_admin    uuid;
  v_expert   uuid;
  v_room     uuid;
  v_review_titles text[] := array['Absolutely thriving', 'Arrived in perfect shape', 'Better than expected',
                                  'Healthy and well packed', 'Good, but smaller than I hoped', 'My new favourite plant'];
  v_review_bodies text[] := array[
    'Packed beautifully with moss around the root ball. Two weeks in and it already has new growth.',
    'The care card was super helpful. The My Garden reminders keep me on track with watering.',
    'Delivery was fast to my area and the plant looked exactly like the photo.',
    'Lost a couple of leaves in transit but bounced back within days. Support chat was very helpful.',
    'A bit smaller than I imagined, but very healthy. Growing fast!',
    'Bought one as a gift and ended up ordering another for myself.'];
begin
  if exists (select 1 from auth.users where email = 'admin@nishorgo.test') then
    raise notice 'Demo data already present — skipping';
    return;
  end if;

  -- ---------------------------------------------------------------- accounts
  for v_person in select * from jsonb_array_elements(v_people) loop
    v_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
            v_person ->> 'email', extensions.crypt('Nishorgo#2026', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', v_person ->> 'name'),
            now() - interval '100 days', now(), '', '', '', '');
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid::text, v_uid,
            jsonb_build_object('sub', v_uid::text, 'email', v_person ->> 'email', 'email_verified', true),
            'email', now(), now(), now());

    update public.profiles set role = (v_person ->> 'role')::public.user_role where id = v_uid;
    insert into public.addresses (user_id, label, recipient, phone, line1, area, city, is_default)
    values (v_uid, 'Home', v_person ->> 'name', '+8801' || (700000000 + floor(random() * 99999999))::bigint,
            'House ' || (1 + floor(random() * 80))::int || ', Road ' || (1 + floor(random() * 30))::int,
            (array['Dhanmondi', 'Gulshan', 'Mirpur', 'Uttara', 'Banani', 'Mohammadpur'])[1 + floor(random() * 6)::int],
            v_person ->> 'city', true);

    if v_person ->> 'role' = 'customer' then
      v_customers := v_customers || v_uid;
    elsif v_person ->> 'role' = 'admin' then
      v_admin := v_uid;
    else
      v_expert := v_uid;
    end if;
  end loop;

  select array_agg(id order by id) into v_products from public.products;

  create temp table demo_orders (id uuid, age integer) on commit drop;

  -- ------------------------------------------------------------------ orders
  for v_i in 1..150 loop
    v_uid := v_customers[1 + floor(random() * array_length(v_customers, 1))::int];
    -- Skew toward recent days so the trend line climbs.
    v_age := floor(power(random(), 1.6) * 89)::int;
    select id into v_addr from public.addresses where user_id = v_uid and is_default;

    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_uid::text, true);

    for v_j in 1..(1 + floor(random() * 3))::int loop
      v_pid := v_products[1 + floor(random() * array_length(v_products, 1))::int];
      v_qty := 1 + floor(random() * 2)::int;
      -- Keep enough stock for the demo by restocking through the ledger.
      if (select stock from public.products where id = v_pid) < v_qty + 3 then
        insert into public.inventory_movements (product_id, delta, reason, note)
        values (v_pid, 25, 'restock', 'Supplier delivery');
      end if;
      insert into public.cart_items (user_id, product_id, quantity) values (v_uid, v_pid, v_qty)
      on conflict (user_id, product_id) do nothing;
    end loop;

    v_coupon := case when random() < 0.15 then 'GREEN100' when random() < 0.12 then 'MONSOON25' end;
    begin
      v_order := public.place_order(v_addr, v_coupon, case when random() < 0.2 then 50 else 0 end, null);
    exception when others then
      -- Coupon minimums / per-user limits: retry without a coupon.
      v_order := public.place_order(v_addr, null, 0, null);
    end;
    v_oid := (v_order ->> 'id')::uuid;
    insert into demo_orders values (v_oid, v_age);

    if v_age = 0 and random() < 0.3 then
      continue;  -- leave a few awaiting payment
    end if;
    if random() < 0.05 then
      update public.orders set status = 'cancelled' where id = v_oid;
      continue;
    end if;

    perform private.mark_order_paid(v_oid, 'pi_demo_' || replace(v_oid::text, '-', ''),
                                    round((v_order ->> 'total')::numeric * 100)::bigint);
    if v_age >= 1 then update public.orders set status = 'processing' where id = v_oid; end if;
    if v_age >= 2 then update public.orders set status = 'shipped', tracking_code = 'PTH' || (100000 + v_i) where id = v_oid; end if;
    if v_age >= 4 then update public.orders set status = 'delivered' where id = v_oid; end if;
  end loop;

  -- ----------------------------------------------------------------- reviews
  for v_uid, v_pid, v_age in
    select distinct on (o.user_id, oi.product_id) o.user_id, oi.product_id, d.age
      from public.orders o
      join demo_orders d on d.id = o.id
      join public.order_items oi on oi.order_id = o.id
     where o.status = 'delivered'
  loop
    continue when random() < 0.35;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    v_i := 1 + floor(random() * 6)::int;
    insert into public.reviews (product_id, user_id, rating, title, body, created_at)
    values (v_pid, v_uid, case when v_i = 5 then 3 + floor(random() * 2)::int else 4 + floor(random() * 2)::int end,
            v_review_titles[v_i], v_review_bodies[v_i], now() - make_interval(days => greatest(v_age - 5, 0)))
    on conflict do nothing;
  end loop;

  insert into public.review_votes (review_id, user_id)
  select r.id, c from public.reviews r cross join unnest(v_customers) c
   where c <> r.user_id and random() < 0.25
  on conflict do nothing;

  -- --------------------------------------------------------------- care logs
  for v_i in 1..60 loop
    select g.id, g.user_id into v_pid, v_uid from public.garden_plants g order by random() limit 1;
    exit when v_pid is null;
    insert into public.care_logs (plant_id, user_id, task, done_at)
    values (v_pid, v_uid, (array['water', 'water', 'water', 'fertilize', 'mist'])[1 + floor(random() * 5)::int]::public.care_task,
            now() - make_interval(days => floor(random() * 6)::int, hours => floor(random() * 12)::int));
  end loop;

  -- -------------------------------------------------------------------- chat
  for v_i in 1..array_length(v_customers, 1) loop
    v_uid := v_customers[v_i];
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    insert into public.chat_messages (room_id, sender_id, body, created_at)
    select r.id, v_uid, m.body, now() - make_interval(hours => (array_length(v_customers, 1) - v_i) * 3 + 1)
      from public.chat_rooms r
      join (values
        ('plant-talk',      'Just repotted my tomato and it already has flowers 🍅'),
        ('plant-clinic',    'Yellow lower leaves on my orchid — overwatering?'),
        ('propagation',     'Anyone have spare marigold seeds to swap?'),
        ('balcony-gardens', 'South-facing balcony, 5 hours sun. What fruit tree should I try?'),
        ('show-off',        'My lavender finally bloomed 💜'),
        ('plant-talk',      'The care reminders are a lifesaver, my plants are actually alive this year'),
        ('plant-clinic',    'Tiny white bugs under the capsicum leaves. Help!'),
        ('balcony-gardens', 'Amrapali mango in a 22" drum, 2nd year, 6 fruits!')
      ) as m(slug, body) on m.slug = r.slug
     where m.body = (array['Just repotted my tomato and it already has flowers 🍅',
                           'Yellow lower leaves on my orchid — overwatering?',
                           'Anyone have spare marigold seeds to swap?',
                           'South-facing balcony, 5 hours sun. What fruit tree should I try?',
                           'My lavender finally bloomed 💜',
                           'The care reminders are a lifesaver, my plants are actually alive this year',
                           'Tiny white bugs under the capsicum leaves. Help!',
                           'Amrapali mango in a 22" drum, 2nd year, 6 fruits!'])[v_i];
  end loop;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_expert, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_expert::text, true);
  insert into public.chat_messages (room_id, sender_id, body)
  select id, v_expert, 'Expert tip 🌿 yellow lower leaves + wet bark = overwatering. Let the medium dry out and check roots for mush.'
    from public.chat_rooms where slug = 'plant-clinic';
  insert into public.chat_messages (room_id, sender_id, body)
  select id, v_expert, 'Those are likely whiteflies. Spray neem oil (5 ml/L + a drop of soap) at dusk, every 3 days for 2 weeks.'
    from public.chat_rooms where slug = 'plant-clinic';

  -- One open support conversation waiting for the expert.
  v_uid := v_customers[1];
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform public.open_support_chat(
    (select id from public.orders where user_id = v_uid and status = 'delivered' order by placed_at desc limit 1),
    'Hi! My hydrangea leaves are drooping in the afternoon. Is that normal in this heat?');

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- -------------------------------------------------------------- back-date
  -- Rewrite timestamps so history spreads across the last 90 days.
  set local session_replication_role = replica;   -- skip triggers while back-dating
  update public.orders o
     set placed_at    = o.placed_at - make_interval(days => d.age, hours => floor(random() * 10)::int),
         paid_at      = o.paid_at - make_interval(days => d.age),
         shipped_at   = o.shipped_at - make_interval(days => greatest(d.age - 2, 0)),
         delivered_at = o.delivered_at - make_interval(days => greatest(d.age - 4, 0)),
         cancelled_at = o.cancelled_at - make_interval(days => d.age),
         expires_at   = case when o.status = 'pending_payment' then now() + interval '25 minutes' end
    from demo_orders d where d.id = o.id;
  update public.order_status_history h
     set created_at = h.created_at - make_interval(days => greatest(d.age - case h.to_status
                                                    when 'shipped' then 2 when 'delivered' then 4
                                                    when 'processing' then 1 else 0 end, 0))
    from demo_orders d where d.id = h.order_id;
  update public.garden_plants g
     set acquired_on = (o.delivered_at at time zone 'Asia/Dhaka')::date
    from public.order_items oi join public.orders o on o.id = oi.order_id
   where g.source_order_item_id = oi.id;
  update public.profiles p set created_at = now() - make_interval(days => floor(random() * 75)::int);
  -- Most plants are well cared for; a few are overdue so reminders have something to say.
  update public.garden_plants
     set last_watered_at = now() - make_interval(hours => floor(random() * 24 * (water_every_days + case when random() < 0.2 then 3 else 0 end))::int),
         last_fertilized_at = case when fertilize_every_days is not null
                                   then now() - make_interval(days => floor(random() * fertilize_every_days)::int) end;
  -- Older notifications are already read; leave the recent ones unread.
  update public.notifications set read_at = now() where created_at < now() - interval '1 minute' or random() < 0.7;
  set local session_replication_role = origin;

  perform private.refresh_analytics();
  raise notice 'Demo data created: % orders', (select count(*) from demo_orders);
end;
$$;
