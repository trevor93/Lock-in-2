declare namespace Cloudflare {
  interface Env {
    DB: D1Database
    OPENAI_API_KEY: string
    OPENAI_BASE_URL: string
    OPENAI_ALLOWED_BASE_URLS?: string
    ENFORCEMENT_JOB_SECRET?: string
  }
}
