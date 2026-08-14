import { describe, expect, it, vi } from 'vitest'
import worker from './index'

describe('enforcement cron worker', () => {
  it('posts to the protected internal enforcement endpoint', async () => {
    const waitUntil = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await worker.scheduled(
      {} as ScheduledController,
      {
        ENFORCEMENT_JOB_URL: 'https://warroom.test/internal/jobs/enforcement',
        ENFORCEMENT_JOB_SECRET: 'test-secret',
      },
      { waitUntil } as unknown as ExecutionContext,
    )

    expect(waitUntil).toHaveBeenCalledTimes(1)
    await waitUntil.mock.calls[0][0]
    expect(fetchMock).toHaveBeenCalledWith(
      'https://warroom.test/internal/jobs/enforcement',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }),
      }),
    )
  })

  it('authenticates through Cloudflare Access when service credentials are configured', async () => {
    const waitUntil = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await worker.scheduled(
      {} as ScheduledController,
      {
        ENFORCEMENT_JOB_URL: 'https://warroom.test/internal/jobs/enforcement',
        ENFORCEMENT_JOB_SECRET: 'test-secret',
        CF_ACCESS_CLIENT_ID: 'test-access-id',
        CF_ACCESS_CLIENT_SECRET: 'test-access-secret',
      },
      { waitUntil } as unknown as ExecutionContext,
    )

    await waitUntil.mock.calls[0][0]
    expect(fetchMock).toHaveBeenCalledWith(
      'https://warroom.test/internal/jobs/enforcement',
      expect.objectContaining({
        headers: expect.objectContaining({
          'CF-Access-Client-Id': 'test-access-id',
          'CF-Access-Client-Secret': 'test-access-secret',
        }),
      }),
    )
  })
})
