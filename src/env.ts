// Book 7 refactor — the environment binding and per-request variable contracts.
// One declaration of what the Workers runtime injects (D1, model config, job
// secret, allowed origins) and what middleware attaches to the request context.

export type Bindings = {
  // Book 7 alarms — operator-set VAPID credentials; absent means push is off.
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_JWK?: string
  VAPID_SUBJECT?: string
  DB: D1Database
  OPENAI_API_KEY: string
  OPENAI_BASE_URL: string
  OPENAI_ALLOWED_BASE_URLS?: string
  ENFORCEMENT_JOB_SECRET?: string
  ALLOWED_ORIGINS?: string
}

export type Variables = {
  userId: number
  agentCredentialId: number
  agentScopes: string[]
  agentRoute: string
}
