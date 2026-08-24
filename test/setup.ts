import { env } from 'cloudflare:test'
import { beforeAll } from 'vitest'

// The migration list is DERIVED from the migrations directory, never hand-listed.
// A hand-written list stops being exhaustive the moment a migration is added: the
// file lands on disk, the schema it creates never reaches the test database, and
// every test touching the new table fails with "no such table" as though the
// migration itself were broken rather than simply unread. Vite resolves this glob
// at build time, so it works inside the workers pool, which cannot read disk at
// runtime.
const migrationModules = import.meta.glob('../migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

// Sorted by path, which sorts by the zero-padded numeric prefix: migrations must
// be applied in the order they were written.
export const migrationPaths = Object.keys(migrationModules).sort()

const migrationNumber = (path: string): string => {
  const name = path.split('/').pop() ?? ''
  return name.slice(0, 4)
}

export function migrationSql(path: string): string {
  const sql = migrationModules[path]
  if (typeof sql !== 'string' || sql.length === 0) {
    throw new Error(`migration source not resolved: ${path}`)
  }
  return sql
}

// 0001-0004 build the legacy schema. Every migration from 0005 on is a change
// under test, and the legacy rows have to be seeded and counted in between, so
// the ordered list is split at that seam and nowhere else.
const LEGACY_SCHEMA_THROUGH = '0004'
const legacyMigrationPaths = migrationPaths.filter(
  (path) => migrationNumber(path) <= LEGACY_SCHEMA_THROUGH,
)
const laterMigrationPaths = migrationPaths.filter(
  (path) => migrationNumber(path) > LEGACY_SCHEMA_THROUGH,
)

export const personalTables = [
  'schedule_blocks', 'block_logs', 'debriefs', 'unit_progress', 'maxims',
  'flashcards', 'card_reviews', 'honesty_flags', 'points_ledger',
  'reward_redemptions', 'law_checks', 'settings', 'intel_entries',
  'book_progress', 'hermes_messages', 'responses', 'response_srs',
  'tongue_reviews', 'tongue_exams', 'day_summary', 'predictions',
  'appeals', 'load_reductions',
] as const

export const preMigrationRowCounts: Record<string, number> = {}

// Split on ';' and strip '--' comments only OUTSIDE single-quoted strings.
// A naive split truncates any statement whose prose contains a semicolon
// (e.g. '...health, skills); ...'), silently applying a partial schema.
function splitOutsideQuotes(text: string): string[] {
  const parts: string[] = []
  let buf = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "'") {
      if (inString && text[i + 1] === "'") { buf += "''"; i++; continue }
      inString = !inString
      buf += ch
      continue
    }
    if (ch === ';' && !inString) { parts.push(buf); buf = ''; continue }
    buf += ch
  }
  parts.push(buf)
  return parts
}

function stripComments(sql: string): string {
  return sql.split('\n').map((line) => {
    let inString = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === "'") {
        if (inString && line[i + 1] === "'") { i++; continue }
        inString = !inString
        continue
      }
      if (!inString && ch === '-' && line[i + 1] === '-') return line.slice(0, i)
    }
    return line
  }).join('\n')
}

export function statements(sql: string): string[] {
  const out: string[] = []
  let normal = ''
  let trigger = ''

  const flushNormalStatements = () => {
    const parts = splitOutsideQuotes(normal)
    normal = parts.pop() || ''
    out.push(...parts.map((statement) => statement.trim()).filter(Boolean))
  }
  const flushNormalAll = () => {
    flushNormalStatements()
    if (normal.trim()) out.push(normal.trim())
    normal = ''
  }

  for (const line of stripComments(sql).split('\n')) {
    if (trigger) {
      trigger += `${line}\n`
      if (/^END;\s*$/i.test(line.trim())) {
        out.push(trigger.trim().replace(/;$/, ''))
        trigger = ''
      }
      continue
    }

    if (/^\s*CREATE\s+TRIGGER\b/i.test(line)) {
      flushNormalAll()
      trigger = `${line}\n`
      continue
    }

    normal += `${line}\n`
  }

  if (trigger.trim()) out.push(trigger.trim().replace(/;$/, ''))
  flushNormalAll()
  return out
}

export async function apply(sql: string): Promise<void> {
  for (const statement of statements(sql)) {
    await env.DB.prepare(statement).run()
  }
}

async function seedPopulatedLegacySchema(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('auth_hash','legacy-verifier-hash')`,
  ).run()
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('auth_salt','legacy-verifier-salt')`,
  ).run()
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('agent_token','legacy-agent-token')`,
  ).run()

  const block = await env.DB.prepare(
    `INSERT INTO schedule_blocks
       (sort_order, start_time, end_time, title, category, days, points)
     VALUES (1,'06:00','06:30','Legacy block','admin','mon',10)`,
  ).run()
  const blockId = Number(block.meta.last_row_id)
  const phase = await env.DB.prepare(
    `INSERT INTO phases (sort_order, code, title) VALUES (1,'LEGACY','Legacy phase')`,
  ).run()
  const unit = await env.DB.prepare(
    `INSERT INTO units (phase_id, sort_order, title) VALUES (?,?,?)`,
  ).bind(Number(phase.meta.last_row_id), 1, 'Legacy unit').run()
  const unitId = Number(unit.meta.last_row_id)
  const maxim = await env.DB.prepare(
    `INSERT INTO maxims
       (source, principle, naive_reading, master_reading)
     VALUES ('Legacy','Legacy principle','naive','master')`,
  ).run()
  const maximId = Number(maxim.meta.last_row_id)
  const response = await env.DB.prepare(
    `INSERT INTO responses (situation, trigger_q, response)
     VALUES ('Legacy situation','Legacy trigger','Legacy response')`,
  ).run()
  const responseId = Number(response.meta.last_row_id)
  const reward = await env.DB.prepare(
    `INSERT INTO rewards (title, cost) VALUES ('Legacy reward',5)`,
  ).run()
  const law = await env.DB.prepare(
    `INSERT INTO laws (sort_order, title, detail) VALUES (1,'Legacy law','Legacy detail')`,
  ).run()
  const lawId = Number(law.meta.last_row_id)

  const statements = [
    env.DB.prepare(`INSERT INTO block_logs (block_id, log_date, status) VALUES (?,'2026-08-14','done')`).bind(blockId),
    env.DB.prepare(`INSERT INTO debriefs (log_date, wins) VALUES ('2026-08-14','Legacy win')`),
    env.DB.prepare(`INSERT INTO unit_progress (unit_id, status) VALUES (?,'active')`).bind(unitId),
    env.DB.prepare(`INSERT INTO flashcards (maxim_id, due_date) VALUES (?,'2026-08-15')`).bind(maximId),
    env.DB.prepare(`INSERT INTO card_reviews (maxim_id, grade) VALUES (?,2)`).bind(maximId),
    env.DB.prepare(`INSERT INTO honesty_flags (flag_date, flag_type, message) VALUES ('2026-08-14','legacy','Legacy flag')`),
    env.DB.prepare(`INSERT INTO points_ledger (log_date, points, reason) VALUES ('2026-08-14',10,'Legacy points')`),
    env.DB.prepare(`INSERT INTO reward_redemptions (reward_id) VALUES (?)`).bind(Number(reward.meta.last_row_id)),
    env.DB.prepare(`INSERT INTO law_checks (law_id, log_date, kept) VALUES (?,'2026-08-14',1)`).bind(lawId),
    env.DB.prepare(`INSERT INTO intel_entries (log_date, domain, title) VALUES ('2026-08-14','other','Legacy intel')`),
    env.DB.prepare(`INSERT INTO book_progress (book_id, chapter_idx, status) VALUES ('legacy_book',0,'reading')`),
    env.DB.prepare(`INSERT INTO hermes_messages (role, content) VALUES ('user','Legacy message')`),
    env.DB.prepare(`INSERT INTO response_srs (response_id, due_date) VALUES (?,'2026-08-15')`).bind(responseId),
    env.DB.prepare(`INSERT INTO tongue_reviews (response_id, review_date, mode, grade) VALUES (?,'2026-08-14','recall',2)`).bind(responseId),
    env.DB.prepare(`INSERT INTO tongue_exams (exam_date, total, correct, score_pct, passed) VALUES ('2026-08-14',1,1,100,1)`),
    env.DB.prepare(`INSERT INTO day_summary (summary_date) VALUES ('2026-08-14')`),
    env.DB.prepare(`INSERT INTO predictions (made_date, claim, confidence, resolve_by) VALUES ('2026-08-14','Legacy prediction',70,'2026-08-20')`),
    env.DB.prepare(`INSERT INTO appeals (appeal_date, block_id, block_date, reason, week_key) VALUES ('2026-08-15',?,'2026-08-14','Legacy appeal reason','2026-W33')`).bind(blockId),
    env.DB.prepare(`INSERT INTO load_reductions (block_id, start_date, end_date) VALUES (?,'2026-08-14','2026-08-17')`).bind(blockId),
  ]
  await env.DB.batch(statements)
}

beforeAll(async () => {
  // A broken glob would resolve to an empty object, every loop below would be a
  // no-op, and the failure would surface as a confusing "no such table" in some
  // unrelated test. Assert the floor here instead, where the message is honest.
  if (migrationPaths.length < 29) {
    throw new Error(
      `migration discovery found only ${migrationPaths.length} files; the glob is broken`,
    )
  }
  if (legacyMigrationPaths.length !== 4) {
    throw new Error(
      `expected 4 legacy migrations, found ${legacyMigrationPaths.length}`,
    )
  }

  for (const path of legacyMigrationPaths) {
    await apply(migrationSql(path))
  }
  await seedPopulatedLegacySchema()
  for (const table of personalTables) {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM ${table}`,
    ).first<{ total: number }>()
    preMigrationRowCounts[table] = row?.total ?? 0
  }
  for (const path of laterMigrationPaths) {
    await apply(migrationSql(path))
  }
})
