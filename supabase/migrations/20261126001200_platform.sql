-- =============================================================================
-- Nishorgo 2.0 · 12 · Platform wiring
-- Realtime publication, Storage buckets + policies, scheduled jobs (pg_cron),
-- and the daily plant-care reminder generator.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Daily care reminders: one friendly digest per user with thirsty plants.
-- -----------------------------------------------------------------------------
create or replace function private.generate_care_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with due as (
    select g.user_id, g.nickname,
           (private.plant_schedule(g) ->> 'water_due_in_days')::int as water_in,
           (private.plant_schedule(g) ->> 'fertilize_due_in_days')::int as feed_in
      from public.garden_plants g
     where not g.is_archived
  ), per_user as (
    select user_id,
           array_agg(nickname order by water_in) filter (where water_in <= 0) as thirsty,
           array_agg(nickname) filter (where feed_in <= 0) as hungry
      from due
     group by user_id
    having bool_or(water_in <= 0) or bool_or(feed_in <= 0)
  ), inserted as (
    insert into public.notifications (user_id, kind, title, body, link, data)
    select u.user_id, 'care',
           case when cardinality(u.thirsty) > 0
                then format('%s plant%s need%s water 💧', cardinality(u.thirsty),
                            case when cardinality(u.thirsty) > 1 then 's' else '' end,
                            case when cardinality(u.thirsty) > 1 then '' else 's' end)
                else 'Feeding day 🌱' end,
           concat_ws(' · ',
             case when cardinality(u.thirsty) > 0 then 'Thirsty: ' || array_to_string(u.thirsty[1:3], ', ')
                  || case when cardinality(u.thirsty) > 3 then format(' +%s', cardinality(u.thirsty) - 3) else '' end end,
             case when cardinality(u.hungry) > 0 then 'Fertilize: ' || array_to_string(u.hungry[1:3], ', ') end),
           '/garden',
           jsonb_build_object('thirsty', coalesce(to_jsonb(u.thirsty), '[]'::jsonb),
                              'hungry', coalesce(to_jsonb(u.hungry), '[]'::jsonb))
      from per_user u
     where not exists (select 1 from public.notifications n
                        where n.user_id = u.user_id and n.kind = 'care'
                          and n.created_at > now() - interval '20 hours')
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

create or replace function private.prune_notifications()
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (
    delete from public.notifications
     where read_at is not null and read_at < now() - interval '60 days'
    returning 1)
  select count(*)::integer from d;
$$;

-- -----------------------------------------------------------------------------
-- Realtime: live notifications, order tracking and stock badges.
-- (postgres_changes respects RLS, so users only receive their own rows.)
-- -----------------------------------------------------------------------------
-- Full old-row images on orders so the admin feed can tell paid-transitions apart.
alter table public.orders replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.orders, public.products;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Storage buckets & policies
--   product-images : public read, staff write
--   avatars, review-photos, garden-photos : public read, owner writes to <uid>/...
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not initialised — skipping buckets';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('product-images', 'product-images', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/avif']),
    ('avatars',        'avatars',        true, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
    ('review-photos',  'review-photos',  true, 5242880, array['image/png', 'image/jpeg', 'image/webp']),
    ('garden-photos',  'garden-photos',  true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;

  execute $p$
    create policy "nishorgo: public read images" on storage.objects
      for select to anon, authenticated
      using (bucket_id in ('product-images', 'avatars', 'review-photos', 'garden-photos'))
  $p$;
  execute $p$
    create policy "nishorgo: staff manage product images" on storage.objects
      for all to authenticated
      using (bucket_id = 'product-images' and (select public.is_staff()))
      with check (bucket_id = 'product-images' and (select public.is_staff()))
  $p$;
  execute $p$
    create policy "nishorgo: users manage own uploads" on storage.objects
      for all to authenticated
      using (bucket_id in ('avatars', 'review-photos', 'garden-photos')
             and (storage.foldername(name))[1] = (select auth.uid())::text)
      with check (bucket_id in ('avatars', 'review-photos', 'garden-photos')
                  and (storage.foldername(name))[1] = (select auth.uid())::text)
  $p$;
end;
$$;

-- -----------------------------------------------------------------------------
-- Scheduled jobs
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_job text;
begin
  foreach v_job in array array['nishorgo-expire-orders', 'nishorgo-refresh-analytics',
                               'nishorgo-care-reminders', 'nishorgo-prune-notifications']
  loop
    perform cron.unschedule(v_job) where exists (select 1 from cron.job where jobname = v_job);
  end loop;

  perform cron.schedule('nishorgo-expire-orders',       '*/5 * * * *',  'select private.expire_stale_orders()');
  perform cron.schedule('nishorgo-refresh-analytics',   '*/15 * * * *', 'select private.refresh_analytics()');
  -- 08:00 Asia/Dhaka = 02:00 UTC
  perform cron.schedule('nishorgo-care-reminders',      '0 2 * * *',    'select private.generate_care_reminders()');
  perform cron.schedule('nishorgo-prune-notifications', '30 3 * * 0',   'select private.prune_notifications()');
end;
$$;
