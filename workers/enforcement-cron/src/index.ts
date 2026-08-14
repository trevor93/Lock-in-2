interface Env {
  ENFORCEMENT_JOB_URL: string
  ENFORCEMENT_JOB_SECRET: string
  CF_ACCESS_CLIENT_ID?: string
  CF_ACCESS_CLIENT_SECRET?: string
}

async function invokeEnforcement(env: Env): Promise<void> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.ENFORCEMENT_JOB_SECRET}`,
    'Content-Type': 'application/json',
  }
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID
    headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET
  }

  const response = await fetch(env.ENFORCEMENT_JOB_URL, {
    method: 'POST',
    headers,
    body: '{}',
  })
  if (!response.ok) throw new Error(`Enforcement job failed with HTTP ${response.status}`)
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(invokeEnforcement(env))
  },
}
