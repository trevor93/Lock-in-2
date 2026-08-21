import { describe, expect, it } from 'vitest'
import intelSource from '../public/static/app/features/council.js?raw'
import statsSource from '../public/static/app/features/debrief.js?raw'

// Book 13.2 — the brake must be present in the UI, not only the server.
describe('Book 13.2 — frontend brake wiring', () => {
  it('offers a heat selector on the capture form', () => {
    expect(intelSource).toMatch(/id="in-heat"/)
    expect(intelSource).toMatch(/baited/)
    expect(intelSource).toMatch(/afraid/)
  })

  it('offers an alternative-explanation field', () => {
    expect(intelSource).toMatch(/id="in-alt"/)
    expect(intelSource).toMatch(/ALTERNATIVE EXPLANATION/)
  })

  it('blocks filing a heated capture with no alternative explanation', () => {
    // The client mirrors the server rule for an instant prompt.
    expect(intelSource).toMatch(/heat !== 'calm' && !alt/)
    expect(intelSource).toMatch(/alternative_explanation/)
  })

  it('surfaces the none-plausible paranoia tell in stats', () => {
    expect(statsSource).toMatch(/alternativeExplanations/)
    expect(statsSource).toMatch(/paranoia tell/i)
  })
})
