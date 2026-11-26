-- =============================================================================
-- Nishorgo 2.0 · 10 · Journal (the legacy blog, reborn)
-- Markdown posts with computed reading time, full-text search, and
-- "shop this story" product links.
-- =============================================================================

create table public.journal_posts (
  id               bigint generated always as identity primary key,
  slug             text not null unique,
  title            text not null check (char_length(title) between 3 and 160),
  excerpt          text check (char_length(excerpt) <= 300),
  body             text not null,
  cover_url        text,
  tags             text[] not null default '{}',
  product_ids      bigint[] not null default '{}',
  author_id        uuid references public.profiles (id) on delete set null,
  reading_minutes  integer generated always as (
                     greatest(1, ceil(array_length(regexp_split_to_array(trim(body), '\s+'), 1) / 200.0))::integer
                   ) stored,
  search_vector    tsvector generated always as (
                     setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                     setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') ||
                     setweight(to_tsvector('english', coalesce(body, '')), 'C')
                   ) stored,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index journal_posts_published_idx on public.journal_posts (published_at desc) where published_at is not null;
create index journal_posts_search_idx    on public.journal_posts using gin (search_vector);

create trigger journal_posts_assign_slug
  before insert or update of title, slug on public.journal_posts
  for each row execute function private.assign_slug('title');
create trigger journal_posts_touch_updated_at
  before update on public.journal_posts
  for each row execute function private.touch_updated_at();

create or replace function public.journal_list(
  p_tag text default null, p_query text default null, p_limit integer default 12, p_offset integer default 0)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with f as (
    select j.*
      from public.journal_posts j
     where j.published_at <= now()
       and (p_tag is null or p_tag = any (j.tags))
       and (nullif(trim(p_query), '') is null or j.search_vector @@ websearch_to_tsquery('english', p_query))
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'tags', (select coalesce(jsonb_agg(distinct t), '[]'::jsonb)
               from public.journal_posts, unnest(tags) t where published_at <= now()),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'slug', x.slug, 'title', x.title, 'excerpt', x.excerpt, 'cover_url', x.cover_url,
                         'tags', x.tags, 'reading_minutes', x.reading_minutes, 'published_at', x.published_at)
                       order by x.published_at desc)
                         from (select * from f order by published_at desc limit p_limit offset p_offset) x), '[]'::jsonb));
$$;

-- Security definer: anonymous readers need the author's public name/avatar,
-- but have no access to the profiles table itself.
create or replace function public.journal_post(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_j public.journal_posts;
begin
  select * into v_j from public.journal_posts where slug = p_slug and published_at <= now();
  if not found then
    raise exception 'Story not found' using errcode = 'P0002', hint = 'not_found';
  end if;
  return to_jsonb(v_j) - 'search_vector' || jsonb_build_object(
    'author', (select jsonb_build_object('name', full_name, 'avatar_url', avatar_url)
                 from public.profiles where id = v_j.author_id),
    'products', (select coalesce(jsonb_agg(private.product_card(p)), '[]'::jsonb)
                   from public.products p where p.id = any (v_j.product_ids) and p.is_active),
    'more', (select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'title', title, 'cover_url', cover_url,
                                                          'reading_minutes', reading_minutes)), '[]'::jsonb)
               from (select * from public.journal_posts
                      where id <> v_j.id and published_at <= now()
                      order by (tags && v_j.tags) desc, published_at desc limit 3) m));
end;
$$;
