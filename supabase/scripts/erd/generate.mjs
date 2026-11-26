#!/usr/bin/env node
// Generates the entity-relationship diagram and data dictionary in docs/erd
// from the live database catalog, so the diagram always matches the schema.
//
//   node supabase/scripts/erd/generate.mjs            # local stack (supabase start)
//   DB_URL=postgresql://... node supabase/scripts/erd/generate.mjs
//   node supabase/scripts/erd/generate.mjs --check    # exit 1 if docs/erd is stale
//
// Needs `psql`; also needs Graphviz `dot` for the SVG/PNG renders.
//
// Outputs (docs/erd):
//   README.md  ERD image, Mermaid diagrams per domain, relationship table,
//              data dictionary, enums
//   erd.dot    Graphviz source (crow's-foot / IE notation)
//   erd.svg    rendered diagram (also erd.png at 150 dpi)
//   erd.mmd    Mermaid source for the overview diagram
//
// Cardinality comes from the constraints:
//   parent side  FK columns NOT NULL -> exactly one (1); nullable -> zero or one (0..1)
//   child side   FK columns unique / PK -> zero or one (0..1); otherwise zero or many (0..*)
//   identifying (solid line) when the FK columns are part of the child's primary key,
//   non-identifying (dashed) otherwise.
// Tables are grouped by the migration that creates them.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const OUT = join(ROOT, 'docs/erd')
const MIGRATIONS = join(ROOT, 'supabase/migrations')
const DB_URL = process.env.DB_URL || 'postgresql://postgres:postgres@localhost:55322/postgres'
const SCHEMAS = process.env.ERD_SCHEMAS || 'public'
const CHECK = process.argv.includes('--check')

// ---------------------------------------------------------------- introspect
const psql = spawnSync('psql', [DB_URL, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', `schemas=${SCHEMAS}`,
  '-f', join(HERE, 'schema.sql')], { encoding: 'utf8', maxBuffer: 64 << 20 })
if (psql.error || psql.status !== 0) {
  console.error(psql.error?.message || psql.stderr)
  process.exit(1)
}
const db = JSON.parse(psql.stdout)

// ------------------------------------------------------------------ grouping
const groups = [] // [{ label, tables: Set }]
const groupOf = new Map()
for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
  const label = file.replace(/^\d+_/, '').replace(/\.sql$/, '')
    .split('_').map((w) => (w === 'and' ? '&' : w[0].toUpperCase() + w.slice(1))).join(' ')
  const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
  const re = /create\s+(?:materialized\s+view|(?:unlogged\s+)?table|(?:or\s+replace\s+)?view)\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi
  const tables = new Set()
  for (const m of sql.matchAll(re)) {
    const key = `${m[1] || 'public'}.${m[2]}`
    if (!groupOf.has(key)) { groupOf.set(key, label); tables.add(key) }
  }
  if (tables.size) groups.push({ label, tables })
}

// --------------------------------------------------------------------- model
const shortType = (t) => t
  .replace(/^(public|extensions)\./, '')
  .replace('timestamp with time zone', 'timestamptz')
  .replace('timestamp without time zone', 'timestamp')
  .replace('character varying', 'varchar')
  .replace('double precision', 'float8')
  .replace(/^character\(/, 'char(')

const rels = new Map()
for (const r of db.relations) {
  const id = `${r.schema}.${r.name}`
  rels.set(r.oid, {
    ...r, id,
    label: r.schema === 'public' ? r.name : id,
    node: (r.schema === 'public' ? r.name : id).replace(/\W/g, '_'),
    group: r.external ? 'External' : groupOf.get(id) || 'Other',
    columns: r.columns.map((c) => ({ ...c, type: shortType(c.type), keys: new Set() })),
    pk: [], uniques: [], fks: [], checks: [], partialUniques: [],
  })
}
const colByNum = (rel, n) => rel.columns.find((c) => c.num === n)
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))

for (const k of db.constraints) {
  const rel = rels.get(k.rel)
  if (!rel) continue
  if (k.type === 'p') rel.pk = k.cols
  else if (k.type === 'u') rel.uniques.push(k.cols)
  else if (k.type === 'c') rel.checks.push(k)
  else if (k.type === 'f') rel.fks.push(k)
}
for (const i of db.uniqueIndexes) {
  const rel = rels.get(i.rel)
  if (rel) (i.partial ? rel.partialUniques : rel.uniques).push(i.partial ? i : i.cols)
}

const relationships = []
for (const rel of rels.values()) {
  for (const n of rel.pk) colByNum(rel, n).keys.add('PK')
  for (const u of rel.uniques) if (u.length === 1) colByNum(rel, u[0]).keys.add('UK')
  for (const fk of rel.fks) {
    const parent = rels.get(fk.refrel)
    for (const n of fk.cols) colByNum(rel, n).keys.add('FK')
    const cols = fk.cols.map((n) => colByNum(rel, n))
    const childUnique = sameSet(fk.cols, rel.pk) || rel.uniques.some((u) => sameSet(u, fk.cols))
    relationships.push({
      name: fk.name, child: rel, parent,
      cols, refcols: fk.refcols.map((n) => colByNum(parent, n)),
      parentMin: cols.every((c) => c.notnull) ? 1 : 0, // is a parent mandatory for each child?
      childMax: childUnique ? 1 : Infinity,             // how many children per parent?
      identifying: fk.cols.every((n) => rel.pk.includes(n)),
      ondelete: { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' }[fk.ondelete],
    })
  }
}
// External tables only show the columns other tables point at.
for (const rel of rels.values()) {
  if (!rel.external) continue
  const used = new Set(relationships.filter((r) => r.parent === rel).flatMap((r) => r.refcols.map((c) => c.num)))
  rel.columns = rel.columns.filter((c) => used.has(c.num) || rel.pk.includes(c.num))
}

const groupOrder = [...groups.map((g) => g.label), 'Other', 'External']
const ordered = [...rels.values()].sort((a, b) =>
  groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) || a.id.localeCompare(b.id))
const byGroup = groupOrder
  .map((label) => ({ label, rels: ordered.filter((r) => r.group === label) }))
  .filter((g) => g.rels.length)
relationships.sort((a, b) => a.child.id.localeCompare(b.child.id) || a.name.localeCompare(b.name))

const parentMult = (r) => (r.parentMin ? '1' : '0..1')
const childMult = (r) => (r.childMax === 1 ? '0..1' : '0..*')
const keyText = (c) => ['PK', 'FK', 'UK'].filter((k) => c.keys.has(k)).join(', ')
const kindName = { r: 'table', p: 'table', v: 'view', m: 'materialized view' }

// ------------------------------------------------------------------- mermaid
const mmdType = (t) => t.replace(/\(.*?\)/g, '').replace(/\s+/g, '_')
const mmdEntity = (rel, keysOnly) => {
  const cols = keysOnly ? rel.columns.filter((c) => c.keys.size) : rel.columns
  const lines = cols.map((c) => {
    const k = keyText(c)
    return `    ${mmdType(c.type)} ${c.name}${k ? ' ' + k : ''}${!c.notnull && !c.keys.has('PK') ? ' "nullable"' : ''}`
  })
  return `  ${rel.node} {\n${lines.join('\n')}\n  }`
}
const mmdRel = (r) => {
  const left = r.parentMin ? '||' : '|o'
  const right = r.childMax === 1 ? 'o|' : 'o{'
  return `  ${r.parent.node} ${left}${r.identifying ? '--' : '..'}${right} ${r.child.node} : "${r.cols.map((c) => c.name).join(', ')}"`
}
const mermaid = (entities, rs) => ['erDiagram', ...entities, ...rs.map(mmdRel)].join('\n')

const overview = mermaid(ordered.map((r) => mmdEntity(r, true)), relationships)
const domainDiagram = (g) => {
  const inGroup = new Set(g.rels)
  const rs = relationships.filter((r) => inGroup.has(r.child) || inGroup.has(r.parent))
  const others = [...new Set(rs.flatMap((r) => [r.child, r.parent]))].filter((x) => !inGroup.has(x))
  const otherEntities = others.sort((a, b) => a.id.localeCompare(b.id))
    .map((x) => `  ${x.node} {\n${x.columns.filter((c) => x.pk.includes(c.num) ||
      rs.some((r) => (r.child === x && r.cols.includes(c)) || (r.parent === x && r.refcols.includes(c))))
      .map((c) => `    ${mmdType(c.type)} ${c.name}${keyText(c) ? ' ' + keyText(c) : ''}`).join('\n')}\n  }`)
  return mermaid([...g.rels.map((r) => mmdEntity(r, false)), ...otherEntities], rs)
}

// ------------------------------------------------------------------ graphviz
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const FONT = 'Helvetica'
const textW = (s, px) => Math.ceil(s.length * px) + 12
const dotNode = (rel) => {
  const keyW = 46
  const nameW = Math.max(...rel.columns.map((c) => textW(c.name, 7)), textW(rel.label, 7.5) - keyW - 30)
  const typeW = Math.max(...rel.columns.map((c) => textW(c.type, 6.2)), 40)
  const headBg = rel.external ? '#8a8f8c' : rel.kind === 'm' || rel.kind === 'v' ? '#5d6b63' : '#2f4a3a'
  const stereo = rel.kind === 'm' || rel.kind === 'v' ? `<BR/><FONT POINT-SIZE="9">«${kindName[rel.kind]}»</FONT>` : ''
  const rows = rel.columns.map((c) => {
    const k = keyText(c).replace(', ', ' ')
    const name = c.keys.has('PK') ? `<U>${esc(c.name)}</U>` : esc(c.name)
    return `<TR><TD PORT="c${c.num}" BORDER="0"><TABLE BORDER="0" CELLSPACING="0" CELLPADDING="3"><TR>` +
      `<TD WIDTH="${keyW}" ALIGN="LEFT">${k ? `<FONT POINT-SIZE="9" COLOR="#2f4a3a"><B>${k}</B></FONT>` : ' '}</TD>` +
      `<TD WIDTH="${nameW}" ALIGN="LEFT">${c.notnull ? '<B>' + name + '</B>' : name}</TD>` +
      `<TD WIDTH="${typeW}" ALIGN="LEFT"><FONT COLOR="#5f6b66">${esc(c.type)}</FONT></TD>` +
      `<TD WIDTH="22" ALIGN="RIGHT">${c.notnull ? '<FONT POINT-SIZE="8" COLOR="#8a948f">NN</FONT>' : ' '}</TD>` +
      `</TR></TABLE></TD></TR>`
  }).join('')
  return `  ${rel.node} [label=<<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0" COLOR="#7d8a83" BGCOLOR="white"${rel.kind === 'm' || rel.kind === 'v' ? ' STYLE="DASHED"' : ''}>` +
    `<TR><TD BGCOLOR="${headBg}" CELLPADDING="6"><FONT COLOR="white"><B>${esc(rel.label)}</B>${stereo}</FONT></TD></TR>` +
    `<HR/>${rows || '<TR><TD> </TD></TR>'}</TABLE>>];`
}
// Crow's-foot ends; the first shape sits against the entity.
const end = { one: 'teetee', zeroOne: 'teeodot', zeroMany: 'crowodot' }
const dotEdge = (r) => `  ${r.parent.node}:c${r.refcols[0].num} -> ${r.child.node}:c${r.cols[0].num} [` +
  `arrowtail=${r.parentMin ? end.one : end.zeroOne}, arrowhead=${r.childMax === 1 ? end.zeroOne : end.zeroMany}` +
  `${r.identifying ? '' : ', style=dashed'}, tooltip="${esc(`${r.parent.label} ${parentMult(r)} — ${childMult(r)} ${r.child.label} (${r.name})`)}"];`

const legend = `  subgraph cluster_legend {
    label=<<B>Legend</B>>; style="rounded"; color="#c5ccc8"; fontsize=11; margin=10;
    node [shape=plaintext, label="", width=0.1, height=0.1];
    edge [dir=both, minlen=2];
    l1a -> l1b [arrowtail=teetee, arrowhead=crowodot, label=<<FONT POINT-SIZE="9">exactly one (1) — zero or many (0..*)</FONT>>];
    l2a -> l2b [arrowtail=teeodot, arrowhead=crowodot, style=dashed, label=<<FONT POINT-SIZE="9">zero or one (0..1) — zero or many (0..*)</FONT>>];
    l3a -> l3b [arrowtail=teetee, arrowhead=teeodot, label=<<FONT POINT-SIZE="9">exactly one (1) — zero or one (0..1)</FONT>>];
    lk [shape=plaintext, label=<<TABLE BORDER="0" CELLPADDING="2"><TR><TD ALIGN="LEFT"><FONT POINT-SIZE="9"><B>PK</B> primary key, <U>underlined</U> · <B>FK</B> foreign key · <B>UK</B> unique</FONT></TD></TR><TR><TD ALIGN="LEFT"><FONT POINT-SIZE="9"><B>bold</B> / NN = NOT NULL · solid line = identifying, dashed = non-identifying</FONT></TD></TR></TABLE>>];
  }`

const dot = `// Generated by supabase/scripts/erd/generate.mjs. Do not edit.
digraph erd {
  graph [rankdir=LR, splines=spline, nodesep=0.35, ranksep=1.1, pad=0.4, fontname="${FONT}", bgcolor="white",
         label=<<B>Nishorgo · Entity-Relationship Diagram</B><BR/><FONT POINT-SIZE="10">crow's-foot notation · schema version ${esc(db.version ?? 'n/a')}</FONT>>,
         labelloc=t, fontsize=16];
  node [shape=plaintext, fontname="${FONT}", fontsize=10];
  edge [dir=both, color="#4b5852", penwidth=1.1, arrowsize=0.9, fontname="${FONT}"];
${byGroup.map((g, i) => `  subgraph cluster_${i} {
    label=<<B>${esc(g.label)}</B>>; style="rounded,filled"; fillcolor="#f5f7f5"; color="#c5ccc8"; fontsize=12; margin=14;
${g.rels.map(dotNode).map((l) => '  ' + l).join('\n')}
  }`).join('\n')}
${legend}
${relationships.map(dotEdge).join('\n')}
}
`

// ---------------------------------------------------------------- data dict.
const mdCell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
const shortDefault = (d) => (d && d.length > 40 ? d.slice(0, 37) + '…' : d)
const tableDoc = (rel) => {
  const out = [`### \`${rel.label}\``, '']
  out.push(`*${kindName[rel.kind]}*${rel.comment ? ' · ' + mdCell(rel.comment) : ''}`, '')
  out.push('| Column | Type | Key | Null | Default / notes |', '|---|---|---|---|---|')
  for (const c of rel.columns) {
    const fk = rel.fks.find((f) => f.cols.includes(c.num))
    const notes = [
      c.identity ? `identity (${c.identity === 'a' ? 'always' : 'by default'})` : '',
      c.generated ? `generated: \`${mdCell(shortDefault(c.default))}\`` : c.default ? `\`${mdCell(shortDefault(c.default))}\`` : '',
      fk ? `→ ${rels.get(fk.refrel).label}.${colByNum(rels.get(fk.refrel), fk.refcols[fk.cols.indexOf(c.num)]).name}` : '',
      c.comment ? mdCell(c.comment) : '',
    ].filter(Boolean).join(' · ')
    out.push(`| ${c.keys.has('PK') ? `**${c.name}**` : c.name} | \`${c.type}\` | ${keyText(c)} | ${c.notnull ? 'NO' : 'yes'} | ${notes} |`)
  }
  const extra = [
    ...rel.uniques.filter((u) => u.length > 1).map((u) => `UNIQUE (${u.map((n) => colByNum(rel, n).name).join(', ')})`),
    ...rel.partialUniques.map((i) => i.def.replace(/^CREATE UNIQUE INDEX (\w+) ON \S+ USING btree/, 'UNIQUE $1')),
    ...rel.checks.map((k) => `${k.name}: ${k.def}`),
  ]
  if (extra.length) out.push('', '**Constraints**', '', ...extra.map((e) => `- \`${mdCell(e)}\``))
  return out.join('\n')
}

const documented = ordered.filter((r) => !r.external)
const readme = `<!-- Generated by supabase/scripts/erd/generate.mjs from the database catalog. Do not edit by hand. -->
# Database ERD

The diagrams and tables below are generated from the live Postgres catalog: tables, columns, keys,
constraints and foreign keys. Schema version \`${db.version ?? 'n/a'}\`: ${documented.filter((r) => r.kind !== 'm' && r.kind !== 'v').length} tables,
${documented.filter((r) => r.kind === 'm' || r.kind === 'v').length} view(s), ${relationships.length} relationships.

Regenerate after changing a migration:

\`\`\`bash
node supabase/scripts/erd/generate.mjs           # against the local stack (supabase start)
\`\`\`

CI does this on every push to \`main\` that touches \`supabase/migrations\`.

## Diagram

Crow's-foot (Information Engineering) notation. Open [erd.svg](erd.svg) for a zoomable version. [erd.png](erd.png) is a raster copy for reports.

![Entity-relationship diagram](erd.svg)

### Reading multiplicity

| Symbol at the end of a line | Meaning |
|---|---|
| bar + bar  \`┼┼\` | exactly one (1) |
| bar + circle \`○┼\` | zero or one (0..1) |
| crow's foot + circle \`○<\` | zero or many (0..*) |

- **Parent side**: exactly one when every FK column is \`NOT NULL\`. Zero or one when the FK is nullable.
- **Child side**: zero or one when the FK columns are unique (or are the primary key). Zero or many otherwise.
- **Solid line**: identifying relationship (the FK is part of the child's primary key). **Dashed line**: non-identifying.

## Overview (keys only)

\`\`\`mermaid
${overview}
\`\`\`

## Relationships

| Parent | | Child | FK column(s) | Multiplicity (parent : child) | On delete |
|---|---|---|---|---|---|
${relationships.map((r) => `| ${r.parent.label} | ${r.identifying ? '━' : '┄'} | ${r.child.label} | ${r.cols.map((c) => c.name).join(', ')} → ${r.refcols.map((c) => c.name).join(', ')} | ${parentMult(r)} : ${childMult(r)} | ${r.ondelete} |`).join('\n')}

## Domains

${byGroup.filter((g) => g.label !== 'External').map((g) => `### ${g.label}

\`\`\`mermaid
${domainDiagram(g)}
\`\`\``).join('\n\n')}

## Data dictionary

${documented.map(tableDoc).join('\n\n')}

## Enumerations

| Type | Values |
|---|---|
${db.enums.map((e) => `| \`${e.name}\` | ${e.values.map((v) => `\`${v}\``).join(', ')} |`).join('\n')}
`

// --------------------------------------------------------------------- write
const files = { 'README.md': readme, 'erd.dot': dot, 'erd.mmd': overview + '\n' }
if (CHECK) {
  const stale = Object.entries(files).filter(([f, s]) => !existsSync(join(OUT, f)) || readFileSync(join(OUT, f), 'utf8') !== s)
  if (stale.length) {
    console.error(`docs/erd is out of date (${stale.map(([f]) => f).join(', ')}). Run: node supabase/scripts/erd/generate.mjs`)
    process.exit(1)
  }
  console.log('docs/erd is up to date.')
  process.exit(0)
}
mkdirSync(OUT, { recursive: true })
for (const [f, s] of Object.entries(files)) writeFileSync(join(OUT, f), s)
for (const [fmt, extra] of [['svg', []], ['png', ['-Gdpi=150']]]) {
  const r = spawnSync('dot', [`-T${fmt}`, ...extra, '-o', join(OUT, `erd.${fmt}`), join(OUT, 'erd.dot')], { encoding: 'utf8' })
  if (r.error) { console.warn('Graphviz `dot` not found; skipped erd.svg / erd.png.'); break }
  if (r.status !== 0) { console.error(r.stderr); process.exit(1) }
}
console.log(`Wrote docs/erd: ${documented.length} relations, ${relationships.length} relationships (schema ${db.version ?? 'n/a'}).`)
