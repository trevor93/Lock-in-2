// Book 7 refactor — centralised request validation and error behaviour.
// One place decides what a malformed request is and how it is refused, so
// routes stay thin. Depends only on zod; the Hono context is passed in.
import { z } from 'zod'

export class RequestValidationError extends Error {}

const emptyBodySchema = z.strictObject({})

export function validationFailed(c: any): Response {
  return c.json({ error: 'VALIDATION FAILED' }, 400)
}

export async function parseJson<T>(c: any, schema: z.ZodType<T>): Promise<T> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch (_) {
    throw new RequestValidationError()
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new RequestValidationError()
  return parsed.data
}

export async function parseEmptyBody(c: any): Promise<void> {
  let body: unknown = {}
  try {
    const text = await c.req.text()
    if (text.trim()) body = JSON.parse(text)
  } catch (_) {
    throw new RequestValidationError()
  }
  if (!emptyBodySchema.safeParse(body).success) {
    throw new RequestValidationError()
  }
}

export function parseValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new RequestValidationError()
  return parsed.data
}
