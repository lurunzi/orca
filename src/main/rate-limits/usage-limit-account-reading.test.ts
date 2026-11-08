import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import {
  readUsageLimitAccountReading,
  usageLimitFromAccountReading
} from './usage-limit-account-reading'

const window = (usedPercent: number, resetsAt: number | null) => ({
  usedPercent,
  windowMinutes: 300,
  resetsAt,
  resetDescription: null
})

const limits = (overrides: Partial<ProviderRateLimits>): ProviderRateLimits => ({
  provider: 'claude',
  session: window(40, 2_000),
  weekly: window(40, 9_000),
  updatedAt: 1_000,
  error: null,
  status: 'ok',
  ...overrides
})

describe('readUsageLimitAccountReading', () => {
  it('waits for the latest reset among used-up windows', () => {
    expect(
      readUsageLimitAccountReading(
        limits({ session: window(100, 2_000), weekly: window(100, 9_000) })
      )
    ).toEqual({ checkedAt: 1_000, exhausted: true, resetsAt: 9_000, usedUpResets: [2_000, 9_000] })
  })

  it('treats a used-up plan with spendable overage as having room', () => {
    expect(
      readUsageLimitAccountReading(
        limits({
          session: window(100, 2_000),
          extraUsage: {
            unit: 'currency',
            enabled: true,
            disabledReason: null,
            resetsAt: null,
            balance: null,
            currencyCode: 'USD',
            spent: 5,
            spendLimit: 50,
            spentPercent: 10
          }
        })
      )?.exhausted
    ).toBe(false)
  })

  it('gives no reading when the last fetch failed', () => {
    expect(readUsageLimitAccountReading(limits({ status: 'error', error: 'x' }))).toBeNull()
  })
})

describe('pooled providers', () => {
  const antigravity = limits({
    provider: 'antigravity',
    session: null,
    weekly: window(100, 50_000),
    buckets: [
      { name: 'Gemini weekly', group: 'Gemini', ...window(100, 50_000) },
      { name: 'Claude 5h', group: '3p', ...window(100, 20_000) },
      { name: 'Other 5h', group: 'Other', ...window(30, 10_000) }
    ]
  })

  it('never holds every chat on one used-up pool, but names the earliest used-up reset', () => {
    const reading = readUsageLimitAccountReading(antigravity, { pooled: true })
    expect(reading?.exhausted).toBe(false)
    expect(usageLimitFromAccountReading(reading, 900)).toEqual({ resetsAt: 20_000 })
  })

  it('cannot explain a failure from a reading taken before it', () => {
    const reading = readUsageLimitAccountReading(antigravity, { pooled: true })
    expect(usageLimitFromAccountReading(reading, 1_001)).toBeNull()
  })
})
