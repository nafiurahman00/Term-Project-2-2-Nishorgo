-- Introspects the database catalog and returns the whole schema as one JSON
-- document. Used by generate.mjs; `:'schemas'` is a comma-separated list.
set search_path = public, extensions;

with rels as (
  select c.oid, n.nspname as schema, c.relname as name, c.relkind::text as kind,
         obj_description(c.oid, 'pg_class') as comment, false as external
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = any (string_to_array(:'schemas', ','))
    and c.relkind in ('r', 'p', 'v', 'm')
    and not c.relispartition
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
),
ext as (  -- tables outside the documented schemas that are referenced by FKs (e.g. auth.users)
  select c.oid, n.nspname, c.relname, c.relkind::text, null::text, true
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.oid in (select confrelid from pg_constraint
                  where contype = 'f' and conrelid in (select oid from rels))
    and c.oid not in (select oid from rels)
),
allrels as (select * from rels union all select * from ext)
select json_build_object(
  'version', (select max(version) from supabase_migrations.schema_migrations),
  'relations', (
    select coalesce(json_agg(json_build_object(
      'oid', r.oid, 'schema', r.schema, 'name', r.name, 'kind', r.kind,
      'comment', r.comment, 'external', r.external,
      'columns', (
        select coalesce(json_agg(json_build_object(
          'num', a.attnum, 'name', a.attname,
          'type', format_type(a.atttypid, a.atttypmod),
          'notnull', a.attnotnull,
          'default', pg_get_expr(ad.adbin, ad.adrelid),
          'identity', nullif(a.attidentity, ''),
          'generated', nullif(a.attgenerated, ''),
          'comment', col_description(a.attrelid, a.attnum)
        ) order by a.attnum), '[]')
        from pg_attribute a
        left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
        where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
      )
    ) order by r.schema, r.name), '[]')
    from allrels r
  ),
  'constraints', (
    select coalesce(json_agg(json_build_object(
      'rel', k.conrelid, 'name', k.conname, 'type', k.contype::text,
      'cols', k.conkey, 'refrel', nullif(k.confrelid, 0), 'refcols', k.confkey,
      'ondelete', k.confdeltype::text, 'onupdate', k.confupdtype::text,
      'def', pg_get_constraintdef(k.oid)
    ) order by k.conrelid, k.conname), '[]')
    from pg_constraint k
    where k.conrelid in (select oid from allrels) and k.contype in ('p', 'u', 'f', 'c')
  ),
  'uniqueIndexes', (  -- unique indexes not backed by a constraint
    select coalesce(json_agg(json_build_object(
      'rel', i.indrelid, 'name', ic.relname,
      'cols', string_to_array(i.indkey::text, ' ')::int[],
      'partial', i.indpred is not null or i.indexprs is not null,
      'def', pg_get_indexdef(i.indexrelid)
    ) order by i.indrelid, ic.relname), '[]')
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    where i.indisunique and not i.indisprimary
      and i.indrelid in (select oid from rels)
      and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)
  ),
  'enums', (
    select coalesce(json_agg(json_build_object(
      'name', t.typname,
      'values', (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)
    ) order by t.typname), '[]')
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typtype = 'e' and n.nspname = any (string_to_array(:'schemas', ','))
  )
);
