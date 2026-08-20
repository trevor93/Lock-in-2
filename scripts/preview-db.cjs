// Apply the repo's migrations and seeds directly into the sqlite file that
// `wrangler pages dev` binds as DB. Local preview setup only — this never
// touches production, which stays operator-controlled.
const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const ROOT = process.cwd()
const D1DIR = path.join(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject')

// The dev server names its sqlite file from an internal id, so discover it
// rather than hardcoding a hash: take the newest non-metadata .sqlite present.
function findServerDb() {
  if (!fs.existsSync(D1DIR)) return null
  const files = fs.readdirSync(D1DIR)
    .filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
    .map((f) => ({ f, m: fs.statSync(path.join(D1DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  return files.length ? path.join(D1DIR, files[0].f) : null
}

const DBFILE = findServerDb()
if (!DBFILE) {
  console.error('server db not found — start `wrangler pages dev` once, hit a')
  console.error('route that touches D1, then re-run this script.')
  process.exit(1)
}
console.log('  target db: ' + path.basename(DBFILE))

// Trigger-aware splitter: identical rule to test/setup.ts so the local preview
// schema matches what the test suite verifies.
// Split on ';' only outside single-quoted strings. The seed files contain
// prose with embedded semicolons ("...health, skills); ..."), so a naive
// split truncates them mid-literal.
function splitOutsideQuotes(text) {
  const parts = []
  let buf = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "'") {
      if (inStr && text[i + 1] === "'") { buf += "''"; i++; continue }  // escaped ''
      inStr = !inStr
      buf += ch
      continue
    }
    if (ch === ';' && !inStr) { parts.push(buf); buf = ''; continue }
    buf += ch
  }
  parts.push(buf)
  return parts
}

// Strip line comments, but never a '--' that sits inside a string literal.
function stripComments(sql) {
  return sql.split('\n').map((line) => {
    let inStr = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === "'") {
        if (inStr && line[i + 1] === "'") { i++; continue }
        inStr = !inStr
        continue
      }
      if (!inStr && ch === '-' && line[i + 1] === '-') return line.slice(0, i)
    }
    return line
  }).join('\n')
}

function statements(sql) {
  const out = []
  let normal = ''
  let trigger = ''
  const flushNormal = () => {
    const parts = splitOutsideQuotes(normal)
    normal = parts.pop() || ''
    out.push(...parts.map((s) => s.trim()).filter(Boolean))
  }
  const flushAll = () => {
    flushNormal()
    if (normal.trim()) out.push(normal.trim())
    normal = ''
  }
  for (const line of stripComments(sql).split('\n')) {
    if (trigger) {
      trigger += line + '\n'
      if (/^END;\s*$/i.test(line.trim())) {
        out.push(trigger.trim().replace(/;$/, ''))
        trigger = ''
      }
      continue
    }
    if (/^\s*CREATE\s+TRIGGER\b/i.test(line)) {
      flushAll()
      trigger = line + '\n'
      continue
    }
    normal += line + '\n'
  }
  if (trigger.trim()) out.push(trigger.trim().replace(/;$/, ''))
  flushAll()
  return out
}

const files = [
  ...fs.readdirSync(path.join(ROOT, 'migrations'))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((f) => path.join('migrations', f)),
  'seed.sql',
  'seed_curriculum.sql',
  'seed_curriculum2.sql',
  'seed_maxims.sql',
]

const db = new DatabaseSync(DBFILE)
db.exec('PRAGMA journal_mode=WAL')
db.exec('PRAGMA foreign_keys=ON')

let applied = 0
let failed = 0
for (const rel of files) {
  const full = path.join(ROOT, rel)
  if (!fs.existsSync(full)) { console.log('  skip (absent) ' + rel); continue }
  const stmts = statements(fs.readFileSync(full, 'utf8'))
  let ok = 0
  const errors = []
  for (const s of stmts) {
    try { db.exec(s); ok++ } catch (e) { errors.push(e.message) }
  }
  applied += ok
  failed += errors.length
  const label = errors.length ? 'PARTIAL' : 'ok'
  console.log('  ' + label.padEnd(8) + rel.padEnd(42) + ok + '/' + stmts.length + ' statements')
  for (const m of errors.slice(0, 3)) console.log('           ! ' + m)
}

// Checkpoint so the bytes are in the main file, not just the WAL sidecar.
db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

const counts = {}
for (const t of ['schedule_blocks', 'phases', 'units', 'maxims', 'laws', 'rewards', 'responses', 'users']) {
  try {
    counts[t] = db.prepare('SELECT COUNT(*) AS n FROM ' + t).get().n
  } catch (e) { counts[t] = 'missing' }
}
const tables = db.prepare(
  "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%'",
).get().n
db.close()

console.log('')
console.log('  statements applied :', applied, '| failed:', failed)
console.log('  tables             :', tables)
console.log('  row counts         :', JSON.stringify(counts))
