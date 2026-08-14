import { env } from 'cloudflare:test'
import { beforeAll } from 'vitest'
import initialSchema from '../migrations/0001_initial_schema.sql?raw'
import intelBooksAlarms from '../migrations/0002_intel_books_alarms.sql?raw'
import tongue from '../migrations/0003_tongue.sql?raw'
import reforge from '../migrations/0004_reforge.sql?raw'

function statements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

beforeAll(async () => {
  for (const migration of [initialSchema, intelBooksAlarms, tongue, reforge]) {
    for (const statement of statements(migration)) {
      await env.DB.prepare(statement).run()
    }
  }
})
