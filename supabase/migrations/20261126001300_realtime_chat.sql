-- =============================================================================
-- Nishorgo 2.0 · 13 · Realtime chat & live storefront
--   * Support chat  — customer ↔ plant experts (optionally about an order)
--   * Greenhouse    — public community rooms (#plant-clinic, #propagation, …)
--   * Reactions, unread counts, DB-level rate limiting, soft deletes
--   * Broadcast-from-database: a live "just bought" feed on the storefront
-- Messages stream to clients via Realtime postgres_changes (RLS-filtered);
-- typing indicators and "who's online" use Realtime Broadcast/Presence.
-- =============================================================================

create type public.chat_room_kind   as enum ('support', 'community');
create type public.chat_room_status as enum ('open', 'waiting', 'resolved');

create table public.chat_rooms (
  id                    uuid primary key default gen_random_uuid(),
  kind                  public.chat_room_kind not null,
  slug                  text unique,
  title                 text not null,
  description           text,
  emoji                 text,
  customer_id           uuid references public.profiles (id) on delete cascade,
  order_id              uuid references public.orders (id) on delete set null,
  status                public.chat_room_status not null default 'open',
  assigned_to           uuid references public.profiles (id) on delete set null,
  last_message_at       timestamptz,
  last_message_preview  text,
  sort_order            smallint not null default 0,
  created_at            timestamptz not null default now(),
  check ((kind = 'support' and customer_id is not null) or (kind = 'community' and slug is not null))
);
-- A customer has at most one active support conversation.
create unique index chat_rooms_one_active_support
  on public.chat_rooms (customer_id) where kind = 'support' and status <> 'resolved';
create index chat_rooms_support_queue on public.chat_rooms (status, last_message_at desc) where kind = 'support';

create table public.chat_members (
  room_id       uuid not null references public.chat_rooms (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  joined_at     timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index chat_members_user_idx on public.chat_members (user_id);

create table public.chat_messages (
  id             bigint generated always as identity primary key,
  room_id        uuid not null references public.chat_rooms (id) on delete cascade,
  sender_id      uuid default auth.uid() references public.profiles (id) on delete set null,
  -- Denormalised sender card so realtime payloads render without a lookup.
  sender_name    text,
  sender_avatar  text,
  sender_role    public.user_role,
  body           text check (char_length(body) <= 2000),
  image_url      text,
  reply_to       bigint references public.chat_messages (id) on delete set null,
  is_system      boolean not null default false,
  created_at     timestamptz not null default now(),
  edited_at      timestamptz,
  deleted_at     timestamptz,
  check (is_system or deleted_at is not null or coalesce(nullif(trim(body), ''), image_url) is not null)
);
create index chat_messages_room_idx   on public.chat_messages (room_id, id desc);
create index chat_messages_sender_idx on public.chat_messages (sender_id, created_at desc);

create table public.chat_reactions (
  message_id  bigint not null references public.chat_messages (id) on delete cascade,
  room_id     uuid not null references public.chat_rooms (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  emoji       text not null check (emoji in ('🌱', '❤️', '😂', '😮', '🙏', '👍')),
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- Full row images so DELETE events carry room_id (needed for realtime filters).
alter table public.chat_reactions replica identity full;

-- -----------------------------------------------------------------------------
-- Access helper
-- -----------------------------------------------------------------------------
create or replace function public.can_access_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chat_rooms r
     where r.id = p_room_id
       and (r.kind = 'community'
            or r.customer_id = auth.uid()
            or public.is_staff()));
$$;

-- -----------------------------------------------------------------------------
-- Broadcast from the database (Realtime Broadcast). Uses realtime.send() on
-- Supabase; falls back to pg_notify where the realtime schema isn't present.
-- -----------------------------------------------------------------------------
create or replace function private.broadcast(p_topic text, p_event text, p_payload jsonb, p_private boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    execute 'select realtime.send($1, $2, $3, $4)' using p_payload, p_event, p_topic, p_private;
  else
    perform pg_notify('nishorgo_' || p_topic, jsonb_build_object('event', p_event, 'payload', p_payload)::text);
  end if;
exception when others then
  -- Never let a broadcast failure break a business transaction.
  raise warning 'broadcast % failed: %', p_topic, sqlerrm;
end;
$$;

-- Live purchase feed: "Someone in Chattogram just adopted a Lavender 🌿"
create or replace function private.orders_broadcast_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    select oi.product_name, oi.product_image, p.slug into v_item
      from public.order_items oi left join public.products p on p.id = oi.product_id
     where oi.order_id = new.id order by oi.line_total desc limit 1;
    perform private.broadcast('storefront', 'purchase', jsonb_build_object(
      'city', coalesce(new.shipping_address ->> 'city', 'Bangladesh'),
      'name', split_part(coalesce((select full_name from public.profiles where id = new.user_id), 'Someone'), ' ', 1),
      'product', v_item.product_name, 'image', v_item.product_image, 'slug', v_item.slug,
      'at', now()));
  end if;
  return null;
end;
$$;

create trigger orders_broadcast_purchase
  after update of status on public.orders
  for each row execute function private.orders_broadcast_purchase();

-- -----------------------------------------------------------------------------
-- Message triggers
-- -----------------------------------------------------------------------------

-- Stamp the sender card and enforce a rate limit of 8 messages / 20 seconds.
create or replace function private.chat_messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.profiles;
begin
  if new.is_system then
    new.sender_id := null;
    new.sender_name := 'Nishorgo';
    return new;
  end if;

  if new.sender_id is null or new.sender_id is distinct from auth.uid() then
    raise exception 'Sender must be the signed-in user' using errcode = '42501';
  end if;

  if (select count(*) from public.chat_messages
       where sender_id = new.sender_id and created_at > now() - interval '20 seconds') >= 8 then
    raise exception 'Slow down a little 🌿 — try again in a few seconds'
      using errcode = 'P0001', hint = 'rate_limited';
  end if;

  select * into v_p from public.profiles where id = new.sender_id;
  new.sender_name   := coalesce(v_p.full_name, 'Plant lover');
  new.sender_avatar := v_p.avatar_url;
  new.sender_role   := v_p.role;
  new.body          := nullif(trim(new.body), '');
  return new;
end;
$$;

create trigger chat_messages_before_insert
  before insert on public.chat_messages
  for each row execute function private.chat_messages_before_insert();

-- Keep room metadata, membership, support-queue status and notifications in sync.
create or replace function private.chat_messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room       public.chat_rooms;
  v_from_staff boolean := new.sender_role in ('staff', 'admin');
  v_preview    text := coalesce(left(new.body, 120), '📷 Photo');
begin
  select * into v_room from public.chat_rooms where id = new.room_id for update;

  update public.chat_rooms
     set last_message_at = new.created_at,
         last_message_preview = case when new.is_system then last_message_preview
                                     else coalesce(new.sender_name, 'Someone') || ': ' || v_preview end,
         status = case
                    when v_room.kind <> 'support' or new.is_system then status
                    when v_from_staff then 'open'
                    else 'waiting' end,
         assigned_to = case when v_room.kind = 'support' and v_from_staff and assigned_to is null
                            then new.sender_id else assigned_to end
   where id = new.room_id;

  if new.sender_id is not null then
    insert into public.chat_members (room_id, user_id, last_read_at)
    values (new.room_id, new.sender_id, new.created_at)
    on conflict (room_id, user_id) do update set last_read_at = excluded.last_read_at;
  end if;

  -- Support notifications, throttled to one per conversation per 10 minutes.
  if v_room.kind = 'support' and not new.is_system then
    if v_from_staff then
      if not exists (select 1 from public.notifications
                      where user_id = v_room.customer_id and kind = 'system'
                        and data ->> 'room_id' = v_room.id::text
                        and created_at > now() - interval '10 minutes') then
        perform private.notify(v_room.customer_id, 'system', 'New reply from a plant expert 💬',
          v_preview, '/support', jsonb_build_object('room_id', v_room.id));
      end if;
    elsif not exists (select 1 from public.notifications
                       where kind = 'admin' and data ->> 'room_id' = v_room.id::text
                         and created_at > now() - interval '10 minutes') then
      if v_room.assigned_to is not null then
        perform private.notify(v_room.assigned_to, 'admin', 'Customer replied: ' || coalesce(new.sender_name, ''),
          v_preview, '/admin/support?room=' || v_room.id, jsonb_build_object('room_id', v_room.id));
      else
        perform private.notify_staff('admin', 'New support message from ' || coalesce(new.sender_name, 'a customer'),
          v_preview, '/admin/support?room=' || v_room.id, jsonb_build_object('room_id', v_room.id));
      end if;
    end if;
  end if;
  return null;
end;
$$;

create trigger chat_messages_after_insert
  after insert on public.chat_messages
  for each row execute function private.chat_messages_after_insert();

-- Authors may edit for 15 minutes; deletes are soft (content wiped, row kept
-- so replies and realtime clients stay consistent). Staff can moderate.
create or replace function private.chat_messages_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.room_id <> old.room_id or new.sender_id is distinct from old.sender_id
       or new.created_at <> old.created_at or new.is_system <> old.is_system
       or new.sender_name is distinct from old.sender_name or new.sender_role is distinct from old.sender_role then
      raise exception 'Only message content can be changed' using errcode = '42501';
    end if;
    if old.deleted_at is not null then
      raise exception 'Message was deleted' using errcode = 'P0001';
    end if;
    if new.deleted_at is null and new.body is distinct from old.body then
      if old.created_at < now() - interval '15 minutes' then
        raise exception 'Messages can only be edited for 15 minutes' using errcode = 'P0001', hint = 'edit_window';
      end if;
      new.edited_at := now();
    end if;
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    new.body := null;
    new.image_url := null;
  end if;
  return new;
end;
$$;

create trigger chat_messages_before_update
  before update on public.chat_messages
  for each row execute function private.chat_messages_before_update();

-- -----------------------------------------------------------------------------
-- Chat API
-- -----------------------------------------------------------------------------

-- Rooms list for the current user: community rooms + support conversations
-- (own for customers; the whole queue for staff), each with unread counts.
create or replace function public.chat_rooms_for_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_staff boolean := public.is_staff();
begin
  return jsonb_build_object(
    'community', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'slug', r.slug, 'title', r.title, 'description', r.description, 'emoji', r.emoji,
               'last_message_at', r.last_message_at, 'last_message_preview', r.last_message_preview,
               'members', (select count(*) from public.chat_members m where m.room_id = r.id),
               'unread', case when v_uid is null then 0 else (
                   select count(*) from public.chat_messages msg
                    where msg.room_id = r.id and msg.sender_id is distinct from v_uid
                      and msg.created_at > coalesce((select last_read_at from public.chat_members m
                                                      where m.room_id = r.id and m.user_id = v_uid), 'infinity')) end)
             order by r.sort_order), '[]'::jsonb)
        from public.chat_rooms r where r.kind = 'community'),
    'support', case when v_uid is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'title', r.title, 'status', r.status, 'order_id', r.order_id,
               'order_number', (select order_number from public.orders where id = r.order_id),
               'customer', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'avatar_url', p.avatar_url,
                                                      'email', case when v_staff then p.email end)
                              from public.profiles p where p.id = r.customer_id),
               'assigned_to', (select full_name from public.profiles where id = r.assigned_to),
               'last_message_at', r.last_message_at, 'last_message_preview', r.last_message_preview,
               'unread', (select count(*) from public.chat_messages msg
                           where msg.room_id = r.id and msg.sender_id is distinct from v_uid and not msg.is_system
                             and msg.created_at > coalesce((select last_read_at from public.chat_members m
                                                             where m.room_id = r.id and m.user_id = v_uid), '-infinity')))
             order by (r.status = 'waiting') desc, r.last_message_at desc nulls last), '[]'::jsonb)
        from public.chat_rooms r
       where r.kind = 'support'
         and (r.customer_id = v_uid or (v_staff and (r.status <> 'resolved' or r.last_message_at > now() - interval '7 days')))) end);
end;
$$;

-- Paged history (newest first, keyset pagination by id), with reactions.
create or replace function public.chat_history(p_room_id uuid, p_before_id bigint default null, p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_access_room(p_room_id) then
    raise exception 'Conversation not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(m) || jsonb_build_object(
             'is_mine', m.sender_id = auth.uid(),
             'reply', (select jsonb_build_object('id', r.id, 'sender_name', r.sender_name, 'body', left(r.body, 140))
                         from public.chat_messages r where r.id = m.reply_to),
             'reactions', (select coalesce(jsonb_agg(jsonb_build_object('emoji', x.emoji, 'count', x.cnt, 'mine', x.mine)), '[]'::jsonb)
                             from (select emoji, count(*) cnt, bool_or(user_id = auth.uid()) mine
                                     from public.chat_reactions where message_id = m.id group by emoji) x))
           order by m.id desc), '[]'::jsonb)
      from (select * from public.chat_messages
             where room_id = p_room_id and (p_before_id is null or id < p_before_id)
             order by id desc limit least(greatest(p_limit, 1), 100)) m);
end;
$$;

create or replace function public.send_chat_message(
  p_room_id uuid, p_body text default null, p_image_url text default null, p_reply_to bigint default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_m   public.chat_messages;
begin
  if not public.can_access_room(p_room_id) then
    raise exception 'Conversation not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  insert into public.chat_messages (room_id, sender_id, body, image_url, reply_to)
  values (p_room_id, v_uid, p_body, p_image_url, p_reply_to)
  returning * into v_m;
  return to_jsonb(v_m);
end;
$$;

-- Find or start the customer's support conversation (optionally about an order).
create or replace function public.open_support_chat(p_order_id uuid default null, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_user();
  v_room  public.chat_rooms;
  v_order public.orders;
begin
  if p_order_id is not null then
    select * into v_order from public.orders where id = p_order_id and user_id = v_uid;
    if not found then
      raise exception 'Order not found' using errcode = 'P0002', hint = 'not_found';
    end if;
  end if;

  select * into v_room from public.chat_rooms
   where kind = 'support' and customer_id = v_uid and status <> 'resolved' for update;

  if not found then
    insert into public.chat_rooms (kind, title, customer_id, order_id, status)
    values ('support', coalesce('Help with ' || v_order.order_number, 'Plant help'), v_uid, p_order_id, 'waiting')
    returning * into v_room;
    insert into public.chat_members (room_id, user_id) values (v_room.id, v_uid);
    insert into public.chat_messages (room_id, is_system, body)
    values (v_room.id, true, 'Hi! 🌿 A Nishorgo plant expert will be with you shortly. Photos of your plant help a lot.');
  elsif p_order_id is not null and v_room.order_id is distinct from p_order_id then
    update public.chat_rooms set order_id = p_order_id where id = v_room.id;
    insert into public.chat_messages (room_id, is_system, body)
    values (v_room.id, true, 'Customer linked order ' || v_order.order_number);
  end if;

  if nullif(trim(p_message), '') is not null then
    insert into public.chat_messages (room_id, sender_id, body) values (v_room.id, v_uid, p_message);
  end if;

  select * into v_room from public.chat_rooms where id = v_room.id;
  return to_jsonb(v_room);
end;
$$;

create or replace function public.resolve_support_chat(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.chat_rooms;
begin
  select * into v_room from public.chat_rooms where id = p_room_id and kind = 'support';
  if not found or not (v_room.customer_id = auth.uid() or public.is_staff()) then
    raise exception 'Conversation not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  insert into public.chat_messages (room_id, is_system, body)
  values (p_room_id, true, 'Conversation marked as resolved ✅');
  update public.chat_rooms set status = 'resolved' where id = p_room_id;
end;
$$;

create or replace function public.mark_room_read(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if not public.can_access_room(p_room_id) then
    raise exception 'Conversation not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  insert into public.chat_members (room_id, user_id, last_read_at) values (p_room_id, v_uid, now())
  on conflict (room_id, user_id) do update set last_read_at = now();
end;
$$;

create or replace function public.toggle_chat_reaction(p_message_id bigint, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_user();
  v_room uuid;
begin
  select room_id into v_room from public.chat_messages where id = p_message_id and deleted_at is null;
  if v_room is null or not public.can_access_room(v_room) then
    raise exception 'Message not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  delete from public.chat_reactions where message_id = p_message_id and user_id = v_uid and emoji = p_emoji;
  if found then
    return false;
  end if;
  insert into public.chat_reactions (message_id, room_id, user_id, emoji) values (p_message_id, v_room, v_uid, p_emoji);
  return true;
end;
$$;

create or replace function public.edit_chat_message(p_message_id bigint, p_body text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_m public.chat_messages;
begin
  update public.chat_messages set body = p_body
   where id = p_message_id and sender_id = private.require_user()
  returning * into v_m;
  if not found then
    raise exception 'Message not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  return to_jsonb(v_m);
end;
$$;

create or replace function public.delete_chat_message(p_message_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_messages set deleted_at = now()
   where id = p_message_id and deleted_at is null
     and (sender_id = private.require_user() or public.is_staff());
  if not found then
    raise exception 'Message not found' using errcode = 'P0002', hint = 'not_found';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.chat_rooms     enable row level security;
alter table public.chat_members   enable row level security;
alter table public.chat_messages  enable row level security;
alter table public.chat_reactions enable row level security;

create policy "chat_rooms: visible" on public.chat_rooms
  for select to anon, authenticated
  using (kind = 'community' or customer_id = (select auth.uid()) or (select public.is_staff()));
create policy "chat_rooms: staff manage" on public.chat_rooms
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "chat_members: own or staff" on public.chat_members
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_staff()));
create policy "chat_members: own upsert" on public.chat_members
  for insert to authenticated with check (user_id = (select auth.uid()) and public.can_access_room(room_id));
create policy "chat_members: own update" on public.chat_members
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "chat_messages: read if room visible" on public.chat_messages
  for select to anon, authenticated using (public.can_access_room(room_id));
create policy "chat_messages: send as self" on public.chat_messages
  for insert to authenticated
  with check (sender_id = (select auth.uid()) and not is_system and public.can_access_room(room_id));
create policy "chat_messages: edit own" on public.chat_messages
  for update to authenticated using (sender_id = (select auth.uid())) with check (sender_id = (select auth.uid()));

create policy "chat_reactions: read if room visible" on public.chat_reactions
  for select to anon, authenticated using (public.can_access_room(room_id));
create policy "chat_reactions: react as self" on public.chat_reactions
  for insert to authenticated with check (user_id = (select auth.uid()) and public.can_access_room(room_id));
create policy "chat_reactions: remove own" on public.chat_reactions
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.chat_rooms, public.chat_members, public.chat_messages, public.chat_reactions from anon;
grant select on public.chat_rooms, public.chat_messages, public.chat_reactions to anon;
revoke update on public.chat_messages from authenticated;
grant update (body, deleted_at) on public.chat_messages to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.slugify(text), public.immutable_join(text[]), public.loyalty_tier(integer), public.shipping_fee_for(numeric),
  public.max_redeemable_points(numeric, integer), public.points_for_order(numeric, integer),
  public.order_transition_allowed(public.order_status, public.order_status),
  public.is_staff(), public.is_admin(), public.current_user_role(),
  public.search_products(text, text, numeric, numeric, public.light_level[], public.care_difficulty[], boolean, boolean, text, integer, integer),
  public.product_detail(text), public.product_recommendations(bigint, integer),
  public.plant_match(public.light_level, public.care_difficulty, boolean, integer, text[], integer),
  public.product_reviews(bigint, text, integer, integer),
  public.journal_list(text, text, integer, integer), public.journal_post(text),
  public.can_access_room(uuid), public.chat_rooms_for_me(), public.chat_history(uuid, bigint, integer)
to anon;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- -----------------------------------------------------------------------------
-- Realtime publication + reference data
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_messages, public.chat_rooms, public.chat_reactions;
  end if;
end;
$$;

insert into public.chat_rooms (kind, slug, title, description, emoji, sort_order) values
  ('community', 'plant-talk',     'Plant Talk',       'Say hi, share wins, ask anything green.',          '🌿', 1),
  ('community', 'plant-clinic',   'Plant Clinic',     'Yellow leaves? Pests? Post a photo and get help.',  '🩺', 2),
  ('community', 'propagation',    'Propagation Lab',  'Cuttings, seeds, and swapping baby plants.',        '🧪', 3),
  ('community', 'balcony-gardens','Balcony Gardens',  'Growing food and flowers in small city spaces.',    '🏙️', 4),
  ('community', 'show-off',       'Show Off',         'Your jungle, your pride. Photos encouraged.',       '📸', 5)
on conflict (slug) do nothing;
