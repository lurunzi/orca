import { describe, expect, it } from 'vitest'
import { parseCursorUsageSummary } from './cursor-usage-summary'

const summary = {
  billingCycleStart: '2026-08-26T12:00:00Z',
  billingCycleEnd: '2026-09-26T12:00:00Z',
  membershipType: 'pro',
  individualUsage: { plan: { used: 2000, limit: 2000, totalPercentUsed: 68.65 } }
}

describe('Cursor monthly summary', () => {
  it('prefers the reported percentage over credit spend and retains the billing window', () => {
    expect(parseCursorUsageSummary(summary)).toEqual({
      planType: 'pro',
      monthly: {
        usedPercent: 68.65,
        windowMinutes: 44_640,
        resetsAt: Date.parse(summary.billingCycleEnd),
        resetDescription: null
      }
    })
  })
  it.each([0, 0.36, 100, 150])('keeps percentage units for %s', (percent) => {
    expect(
      parseCursorUsageSummary({ individualUsage: { plan: { totalPercentUsed: percent } } })?.monthly
        .usedPercent
    ).toBe(Math.min(100, percent))
  })
  it('supports explicit credit budgets without inferring missing spend as zero', () => {
    expect(
      parseCursorUsageSummary({ individualUsage: { overall: { used: 10, limit: 40 } } })?.monthly
        .usedPercent
    ).toBe(25)
    expect(
      parseCursorUsageSummary({ individualUsage: { plan: { used: 0, limit: 40 } } })?.monthly
        .usedPercent
    ).toBe(0)
  })
  it.each([
    {},
    null,
    { individualUsage: { plan: {} } },
    { individualUsage: { plan: { limit: 100 } } },
    { individualUsage: { plan: { used: 10, limit: 0 } } },
    { individualUsage: { plan: { totalPercentUsed: -1 } } },
    { individualUsage: { plan: { totalPercentUsed: '40' } } },
    { individualUsage: { plan: { totalPercentUsed: 50, enabled: false } } },
    { teamUsage: { pooled: { used: 10, limit: 20 } } }
  ])('rejects missing or unsupported allowance %j', (value) => {
    expect(parseCursorUsageSummary(value)).toBeNull()
  })
})
