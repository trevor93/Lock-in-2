import bridgeUi from '../public/static/app6.js?raw'
import bridge from '../public/static/hermes_bridge.py?raw'
import { describe, expect, it } from 'vitest'

describe('Book 5.5 Hermes bridge safety', () => {
  it('uses HTTPS, bounded verified requests, and versioned endpoints', () => {
    expect(bridge).toContain('parsed_base.scheme != "https"')
    expect(bridge).toContain('TIMEOUT = (5, 30)')
    expect(bridge).not.toContain('verify=False')
    expect(bridge).toContain('def read(path):')
    expect(bridge).toContain('json={}')
    expect(bridge).not.toContain('requests.get(')
    expect(bridge).toContain('/api/agent/v1/briefing')
    expect(bridge).toContain('/api/agent/v1/block-log')
  })

  it('distinguishes authentication, scope, rate, and upstream failures', () => {
    expect(bridge).toContain('status == 401')
    expect(bridge).toContain('status == 403')
    expect(bridge).toContain('status == 429')
    expect(bridge).toContain('status >= 500')
  })

  it('requires explicit full-export authorization', () => {
    expect(bridge).toContain('--authorize-full-export')
    expect(bridge).toContain('Refusing full export')
    expect(bridge).toContain('/api/agent/v1/export')
  })

  it('does not expose credentials in process listings or shell history', () => {
    expect(bridge).not.toContain('WARROOM_TOKEN", "")')
    expect(bridge).toContain('WARROOM_TOKEN_FILE')
    expect(bridgeUi).not.toContain('printf %s "')
    expect(bridgeUi).toContain('cat &gt; ~/.config/warroom/agent_token')
  })

  it('does not print credentials or raw HTTP error responses', () => {
    expect(bridge).not.toMatch(/print\([^\n]*(TOKEN|HEADERS)/)
    expect(bridge).not.toContain('raise_for_status')
    expect(bridge).not.toContain('print(response.text)')
  })
})
