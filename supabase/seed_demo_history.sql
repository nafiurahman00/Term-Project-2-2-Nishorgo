-- =============================================================================
-- Nishorgo 2.0 · DEMO history (development / showcase only — do NOT run in prod)
--
-- Run after seed.sql, seed_catalog.sql and seed_demo.sql. Adds ~6 months of
-- realistic activity on top: 32 more customers, ~420 orders placed through the
-- real business functions, reviews, votes, wishlists, care logs and chat.
-- Every account's password is Nishorgo#2026. Idempotent: skips if present.
-- =============================================================================

do $$
declare
  v_people text[][] := array[
    ['nadia.rahman', 'Nadia Rahman', 'Dhaka'],        ['sakib.hasan', 'Sakib Hasan', 'Dhaka'],
    ['tahmina.akter', 'Tahmina Akter', 'Chattogram'], ['rafiq.islam', 'Rafiqul Islam', 'Sylhet'],
    ['mehjabin.c', 'Mehjabin Chowdhury', 'Dhaka'],    ['arnob.das', 'Arnob Das', 'Khulna'],
    ['farzana.haque', 'Farzana Haque', 'Rajshahi'],  ['zahid.khan', 'Zahid Khan', 'Dhaka'],
    ['priyanka.saha', 'Priyanka Saha', 'Dhaka'],     ['mahmud.alam', 'Mahmudul Alam', 'Cumilla'],
    ['sumaiya.binte', 'Sumaiya Binte Kabir', 'Dhaka'], ['tanvir.ahmed', 'Tanvir Ahmed', 'Gazipur'],
    ['rubina.yasmin', 'Rubina Yasmin', 'Barishal'],  ['shuvo.roy', 'Shuvo Roy', 'Dhaka'],
    ['ishrat.jahan', 'Ishrat Jahan', 'Narayanganj'], ['kamrul.hasan', 'Kamrul Hasan', 'Mymensingh'],
    ['anika.tabassum', 'Anika Tabassum', 'Dhaka'],   ['fahim.morshed', 'Fahim Morshed', 'Chattogram'],
    ['lamia.sultana', 'Lamia Sultana', 'Dhaka'],     ['rakib.uddin', 'Rakib Uddin', 'Rangpur'],
    ['nusaiba.karim', 'Nusaiba Karim', 'Dhaka'],     ['asif.iqbal', 'Asif Iqbal', 'Sylhet'],
    ['munira.akhter', 'Munira Akhter', 'Dhaka'],     ['sajid.hossain', 'Sajid Hossain', 'Bogura'],
    ['tasnim.ferdous', 'Tasnim Ferdous', 'Dhaka'],   ['habib.rahman', 'Habibur Rahman', 'Jessore'],
    ['raisa.mahmud', 'Raisa Mahmud', 'Dhaka'],       ['nayeem.chowdhury', 'Nayeem Chowdhury', 'Chattogram'],
    ['jannatul.ferdous', 'Jannatul Ferdous', 'Dhaka'], ['omar.faruk', 'Omar Faruk', 'Cumilla'],
    ['sharmin.nahar', 'Sharmin Nahar', 'Khulna'],    ['imtiaz.rahman', 'Imtiaz Rahman', 'Dhaka']
  ];
  v_areas text[] := array['Dhanmondi', 'Gulshan', 'Mirpur', 'Uttara', 'Banani', 'Mohammadpur', 'Bashundhara',
                          'Khilgaon', 'Lalmatia', 'Wari', 'Agrabad', 'Nasirabad', 'Zindabazar', 'Sonadanga'];
  v_uid      uuid;
  v_new      uuid[] := '{}';
  v_all      uuid[];
  v_i        integer;
  v_j        integer;
  v_age      integer;
  v_pid      bigint;
  v_qty      integer;
  v_addr     bigint;
  v_order    jsonb;
  v_oid      uuid;
  v_coupon   text;
  v_name     text;
  v_rating   integer;
  v_expert   uuid;
  v_titles   text[] := array['Healthy and well packed', 'Exactly as pictured', 'Thriving on my balcony',
    'Great value', 'Fast delivery to my area', 'Bigger than I expected', 'My new favourite',
    'Good, but took a while to settle', 'Arrived a little stressed', 'Already flowering!',
    'Perfect gift', 'Would buy again', 'Lovely plant, average pot', 'Excellent quality'];
  v_bodies   text[] := array[
    'The %s arrived in perfect condition — roots wrapped in damp moss and the pot taped up so no soil spilled.',
    'Ordered the %s for my new flat and it has already put out two new leaves. The care card was really useful.',
    'Delivery to %s took two days and the rider called before arriving. The plant looks exactly like the photos.',
    'I was nervous ordering plants online, but the %s came healthier than the ones at my local nursery.',
    'The %s dropped a couple of leaves in the first week but bounced back quickly after I moved it closer to the window.',
    'Bought the %s as a gift for my mother. She loved it, and the expert chat helped her pick a good spot for it.',
    'Good size for the price. The My Garden reminders keep me from overwatering, which is usually my problem.',
    'Second time buying from Nishorgo. The %s is doing great on our rooftop alongside last year''s order.',
    'Slightly smaller than I expected, but very healthy and growing fast in the monsoon heat.',
    'Customer support answered within minutes when I asked about yellow leaves. Turned out I was watering too much!',
    'Packaging was excellent and fully plastic-free. The %s settled in within a week.',
    'Honestly the best plant shopping experience I''ve had in Dhaka. Will order again before winter.'];
  v_chat     text[][] := array[
    ['plant-talk', 'Just received my Monstera — it''s already got a split leaf! 🌿'],
    ['plant-clinic', 'My adenium''s leaves are turning yellow after all this rain. Should I stop watering?'],
    ['balcony-gardens', 'West-facing balcony, very hot afternoons. Bougainvillea or crown of thorns?'],
    ['show-off', 'First dragon fruit flower opened last night 🌙 Hand-pollinated it with a brush.'],
    ['propagation', 'Pothos cuttings rooted in water in 10 days. Who wants some?'],
    ['plant-clinic', 'White cottony bugs on my hibiscus — mealybugs?'],
    ['plant-talk', 'The pet-safe filter is so useful, my cat chews everything 🐈'],
    ['balcony-gardens', 'Started a mini kitchen garden: lal shak, coriander and chillies in grow bags.'],
    ['show-off', 'Ficus bonsai, three months in. Finally getting the hang of pruning.'],
    ['propagation', 'Has anyone propagated jade from a single leaf? How long did it take?']];
begin
  if exists (select 1 from auth.users where email = 'nadia.rahman@nishorgo.test') then
    raise notice 'Demo history already present — skipping';
    return;
  end if;

  -- ---------------------------------------------------------------- accounts
  for v_i in 1..array_length(v_people, 1) loop
    v_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
            v_people[v_i][1] || '@nishorgo.test', extensions.crypt('Nishorgo#2026', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', v_people[v_i][2]),
            now() - interval '200 days', now(), '', '', '', '');
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid::text, v_uid,
            jsonb_build_object('sub', v_uid::text, 'email', v_people[v_i][1] || '@nishorgo.test', 'email_verified', true),
            'email', now(), now(), now());
    insert into public.addresses (user_id, label, recipient, phone, line1, area, city, is_default)
    values (v_uid, (array['Home', 'Home', 'Office', 'Parents'])[1 + floor(random() * 4)::int], v_people[v_i][2],
            '+8801' || (300000000 + floor(random() * 699999999))::bigint,
            'House ' || (1 + floor(random() * 120))::int || ', Road ' || (1 + floor(random() * 40))::int,
            v_areas[1 + floor(random() * array_length(v_areas, 1))::int], v_people[v_i][3], true);
    v_new := v_new || v_uid;
  end loop;

  select array_agg(id) into v_all from public.profiles where role = 'customer';
  select id into v_expert from public.profiles where role = 'staff' limit 1;

  create temp table demo2_orders (id uuid, age integer) on commit drop;

  -- ------------------------------------------------------------------ orders
  -- New customers order more often; older demo customers keep buying too.
  for v_i in 1..420 loop
    v_uid := case when random() < 0.75 then v_new[1 + floor(random() * array_length(v_new, 1))::int]
                  else v_all[1 + floor(random() * array_length(v_all, 1))::int] end;
    v_age := floor(power(random(), 1.35) * 179)::int;
    select id into v_addr from public.addresses where user_id = v_uid and is_default;

    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_uid::text, true);

    for v_j in 1..(1 + floor(power(random(), 1.8) * 4))::int loop
      v_qty := case when random() < 0.8 then 1 else 2 end;
      -- Popular (featured) and affordable plants sell more often.
      select id into v_pid from public.products
       where is_active and stock >= v_qty + 2
       order by random() / (case when is_featured then 2.5 else 1 end) / (case when price < 500 then 1.6 else 1 end)
       limit 1;
      exit when v_pid is null;
      -- Supplier deliveries: top up best-sellers before they run dry.
      if (select stock from public.products where id = v_pid) < 8 and random() < 0.6 then
        insert into public.inventory_movements (product_id, delta, reason, note)
        values (v_pid, 20 + floor(random() * 20)::int, 'restock', 'Supplier delivery');
      end if;
      insert into public.cart_items (user_id, product_id, quantity) values (v_uid, v_pid, v_qty)
      on conflict (user_id, product_id) do nothing;
    end loop;
    continue when not exists (select 1 from public.cart_items where user_id = v_uid);

    v_coupon := case when random() < 0.10 then 'GREEN100' when random() < 0.08 then 'MONSOON25'
                     when random() < 0.06 then 'WELCOME10' end;
    begin
      v_order := public.place_order(v_addr, v_coupon, case when random() < 0.15 then 80 else 0 end, null);
    exception when others then
      -- Coupon minimums / per-user limits / not enough points: retry plainly.
      v_order := public.place_order(v_addr, null, 0, null);
    end;
    v_oid := (v_order ->> 'id')::uuid;
    insert into demo2_orders values (v_oid, v_age);

    continue when v_age = 0 and random() < 0.4;          -- a few still awaiting payment
    if random() < 0.06 then
      perform set_config('nishorgo.status_note', 'Cancelled by customer', true);
      update public.orders set status = 'cancelled' where id = v_oid;
      continue;
    end if;

    perform private.mark_order_paid(v_oid, 'pi_demo_' || replace(v_oid::text, '-', ''),
                                    round((v_order ->> 'total')::numeric * 100)::bigint);
    if v_age >= 1 then update public.orders set status = 'processing' where id = v_oid; end if;
    if v_age >= 2 then
      update public.orders set status = 'shipped', tracking_code = 'PTH' || (200000 + v_i) where id = v_oid;
    end if;
    if v_age >= 4 then update public.orders set status = 'delivered' where id = v_oid; end if;
    if v_age >= 10 and random() < 0.02 then
      perform set_config('nishorgo.status_note', 'Damaged in transit — refunded', true);
      update public.orders set status = 'refunded' where id = v_oid;
    end if;
  end loop;

  -- ----------------------------------------------------------------- reviews
  for v_uid, v_pid, v_age, v_name in
    select distinct on (o.user_id, oi.product_id) o.user_id, oi.product_id, d.age, oi.product_name
      from public.orders o
      join demo2_orders d on d.id = o.id
      join public.order_items oi on oi.order_id = o.id
     where o.status = 'delivered'
  loop
    continue when random() < 0.45;
    v_rating := case when random() < 0.62 then 5 when random() < 0.75 then 4 when random() < 0.7 then 3
                     when random() < 0.6 then 2 else 1 end;
    v_i := 1 + floor(random() * array_length(v_bodies, 1))::int;
    insert into public.reviews (product_id, user_id, rating, title, body, created_at)
    values (v_pid, v_uid, v_rating,
            case when v_rating <= 2 then 'Not quite what I hoped'
                 when v_rating = 3 then 'Decent, with a few issues'
                 else v_titles[1 + floor(random() * array_length(v_titles, 1))::int] end,
            format(v_bodies[v_i], case when v_i = 3 then (select a.area from public.addresses a where a.user_id = v_uid and a.is_default)
                                       else v_name end),
            now() - make_interval(days => greatest(v_age - 6 - floor(random() * 10)::int, 0)))
    on conflict do nothing;
  end loop;

  insert into public.review_votes (review_id, user_id)
  select r.id, c from public.reviews r cross join unnest(v_all) c
   where c <> r.user_id and random() < 0.08
  on conflict do nothing;

  -- --------------------------------------------------------------- wishlists
  insert into public.wishlist_items (user_id, product_id)
  select u, p.id from unnest(v_new) u
   cross join lateral (select id from public.products order by random() limit (2 + floor(random() * 5))::int) p
  on conflict do nothing;

  -- --------------------------------------------------------------- care logs
  for v_i in 1..400 loop
    select g.id, g.user_id into v_pid, v_uid from public.garden_plants g
     where g.user_id = any (v_new) order by random() limit 1;
    exit when v_pid is null;
    insert into public.care_logs (plant_id, user_id, task, done_at)
    values (v_pid, v_uid, (array['water', 'water', 'water', 'water', 'fertilize', 'mist', 'prune'])[1 + floor(random() * 7)::int]::public.care_task,
            now() - make_interval(days => floor(random() * 20)::int, hours => floor(random() * 14)::int));
  end loop;

  -- -------------------------------------------------------------------- chat
  for v_i in 1..array_length(v_chat, 1) loop
    v_uid := v_new[v_i];
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    insert into public.chat_messages (room_id, sender_id, body)
    select id, v_uid, v_chat[v_i][2] from public.chat_rooms where slug = v_chat[v_i][1];
  end loop;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_expert, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_expert::text, true);
  insert into public.chat_messages (room_id, sender_id, body)
  select id, v_expert, 'Yes — pause watering until the soil dries and move it under cover. Adeniums rot fast in constant rain.'
    from public.chat_rooms where slug = 'plant-clinic';
  insert into public.chat_messages (room_id, sender_id, body)
  select id, v_expert, 'Those are mealybugs. Wipe them off with cotton dipped in rubbing alcohol, then spray neem oil weekly.'
    from public.chat_rooms where slug = 'plant-clinic';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- -------------------------------------------------------------- back-date
  set local session_replication_role = replica;   -- skip triggers while back-dating
  update public.orders o
     set placed_at    = o.placed_at - make_interval(days => d.age, hours => floor(random() * 12)::int, mins => floor(random() * 60)::int),
         paid_at      = o.paid_at - make_interval(days => d.age),
         shipped_at   = o.shipped_at - make_interval(days => greatest(d.age - 2, 0)),
         delivered_at = o.delivered_at - make_interval(days => greatest(d.age - 4, 0)),
         cancelled_at = o.cancelled_at - make_interval(days => d.age),
         expires_at   = case when o.status = 'pending_payment' then now() + interval '25 minutes' end
    from demo2_orders d where d.id = o.id;
  update public.order_status_history h
     set created_at = h.created_at - make_interval(days => greatest(d.age - case h.to_status
                                                    when 'shipped' then 2 when 'delivered' then 4
                                                    when 'processing' then 1 else 0 end, 0))
    from demo2_orders d where d.id = h.order_id;
  update public.inventory_movements m set created_at = o.placed_at
    from public.orders o join demo2_orders d on d.id = o.id where m.order_id = o.id and m.reason = 'sale';
  update public.loyalty_ledger l set created_at = coalesce(o.delivered_at, o.placed_at)
    from public.orders o join demo2_orders d on d.id = o.id where l.order_id = o.id;
  update public.garden_plants g
     set acquired_on = (o.delivered_at at time zone 'Asia/Dhaka')::date
    from public.order_items oi join public.orders o on o.id = oi.order_id join demo2_orders d on d.id = o.id
   where g.source_order_item_id = oi.id;
  -- Customers joined a little before their first order.
  update public.profiles p
     set created_at = coalesce((select min(o.placed_at) from public.orders o where o.user_id = p.id), now())
                      - make_interval(days => 1 + floor(random() * 20)::int)
   where p.id = any (v_new);
  update public.garden_plants
     set last_watered_at = now() - make_interval(hours => floor(random() * 24 * (water_every_days + case when random() < 0.15 then 3 else 0 end))::int),
         last_fertilized_at = case when fertilize_every_days is not null
                                   then now() - make_interval(days => floor(random() * fertilize_every_days)::int) end
   where user_id = any (v_new);
  update public.notifications set read_at = now()
   where user_id = any (v_new) and (created_at < now() - interval '1 minute' or random() < 0.8);
  set local session_replication_role = origin;

  perform private.refresh_analytics();
  raise notice 'Demo history created: % orders for % new customers',
    (select count(*) from demo2_orders), array_length(v_new, 1);
end;
$$;
