import { describe, expect, it } from 'vitest'
import {
  fsrsReview, retrievability, intervalForRetention, sm2ToFsrs,
  DEFAULT_REQUEST_RETENTION, type MemoryState,
} from '../src/fsrs'

// Book 7 SM-2 -> FSRS. These assert the SCHEDULER'S PROPERTIES, not weight-specific
// magic numbers, so they stay valid if the weights are later tuned per user.

describe('B7 FSRS scheduler', () => {
  it('retrievability is 1 at zero elapsed, ~0.9 at one stability, and monotically decays', () => {
    expect(retrievability(0, 10)).toBeCloseTo(1, 5)
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 2) // elapsed == stability -> 90%
    expect(retrievability(40, 10)).toBeLessThan(retrievability(20, 10))
  })

  it('interval grows with stability and shrinks as target retention rises', () => {
    expect(intervalForRetention(20)).toBeGreaterThan(intervalForRetention(5))
    // Demanding 97% recall schedules sooner than demanding 80%.
    expect(intervalForRetention(20, 0.97)).toBeLessThan(intervalForRetention(20, 0.8))
    expect(intervalForRetention(0.1)).toBeGreaterThanOrEqual(1) // never zero
  })

  it('a first review seeds higher stability for easier grades', () => {
    const again = fsrsReview(null, 0, 0)
    const good = fsrsReview(null, 2, 0)
    const easy = fsrsReview(null, 3, 0)
    expect(again.state.stability).toBeLessThan(good.state.stability)
    expect(good.state.stability).toBeLessThanOrEqual(easy.state.stability)
    // Easy is less difficult than Again.
    expect(easy.state.difficulty).toBeLessThan(again.state.difficulty)
    for (const r of [again, good, easy]) {
      expect(r.state.difficulty).toBeGreaterThanOrEqual(1)
      expect(r.state.difficulty).toBeLessThanOrEqual(10)
      expect(r.state.stability).toBeGreaterThan(0)
      expect(r.interval).toBeGreaterThanOrEqual(1)
    }
  })

  it('a successful recall increases stability; a lapse never increases it', () => {
    const prior: MemoryState = { stability: 10, difficulty: 5 }
    const elapsed = 10 // reviewed right at ~90% retention
    const good = fsrsReview(prior, 2, elapsed)
    expect(good.state.stability, 'Good recall should strengthen memory').toBeGreaterThan(prior.stability)

    const lapse = fsrsReview(prior, 0, elapsed)
    expect(lapse.state.stability, 'a forgotten card must not become more stable')
      .toBeLessThanOrEqual(prior.stability)
    // A lapse also drives the next interval down relative to a success.
    expect(lapse.interval).toBeLessThan(good.interval)
  })

  it('Easy strengthens at least as much as Good for the same review', () => {
    const prior: MemoryState = { stability: 8, difficulty: 6 }
    const good = fsrsReview(prior, 2, 8)
    const easy = fsrsReview(prior, 3, 8)
    expect(easy.state.stability).toBeGreaterThanOrEqual(good.state.stability)
  })

  it('rejects an out-of-range grade', () => {
    expect(() => fsrsReview(null, 4, 0)).toThrow()
    expect(() => fsrsReview(null, -1, 0)).toThrow()
  })

  it('sm2ToFsrs maps interval->stability and (inverse) ease->difficulty sensibly', () => {
    // Longer SM-2 interval => higher initial stability.
    expect(sm2ToFsrs({ interval_days: 30, ease: 2.5, lapses: 0 }).stability)
      .toBeGreaterThan(sm2ToFsrs({ interval_days: 3, ease: 2.5, lapses: 0 }).stability)
    // Lower ease (harder card) => higher difficulty.
    expect(sm2ToFsrs({ interval_days: 10, ease: 1.3, lapses: 0 }).difficulty)
      .toBeGreaterThan(sm2ToFsrs({ interval_days: 10, ease: 2.5, lapses: 0 }).difficulty)
    // Lapses raise difficulty.
    expect(sm2ToFsrs({ interval_days: 10, ease: 2.0, lapses: 5 }).difficulty)
      .toBeGreaterThan(sm2ToFsrs({ interval_days: 10, ease: 2.0, lapses: 0 }).difficulty)
    // A brand-new/lapsed card (interval 0) still gets positive stability.
    expect(sm2ToFsrs({ interval_days: 0, ease: 2.5, lapses: 0 }).stability).toBeGreaterThan(0)
    // Everything stays in the valid ranges.
    for (const ease of [1.3, 2.0, 2.5, 3.0]) {
      const s = sm2ToFsrs({ interval_days: 15, ease, lapses: 2 })
      expect(s.difficulty).toBeGreaterThanOrEqual(1)
      expect(s.difficulty).toBeLessThanOrEqual(10)
    }
  })

  it('a Good-graded card converges to a growing, stable review cadence', () => {
    // Simulate reviewing on time (at the returned interval) with Good each time;
    // stability and interval should climb monotonically toward long spacing.
    let state: MemoryState | null = null
    let interval = 0
    let last = 0
    for (let i = 0; i < 6; i++) {
      const out = fsrsReview(state, 2, interval, undefined, DEFAULT_REQUEST_RETENTION)
      expect(out.interval).toBeGreaterThanOrEqual(last)
      state = out.state
      interval = out.interval
      last = out.interval
    }
    expect(interval).toBeGreaterThan(5) // spacing widened well beyond the first step
  })
})
