import { describe, expect, it, vi } from 'vitest'
import type {
  ProviderRateLimits,
  RateLimitBucket
} from '../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import {
  formatPoolShortLabel,
  formatStatusBarSectionLabel,
  formatPoolWindowLabel
} from './usage-pool-label'
import { getTightestUsageSection } from './usage-headline-sections'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values: Record<string, string> = {}) =>
    Object.entries(values).reduce(
      (text, [key, value]) => text.replace(`{{${key}}}`, value),
      fallback
    )
}))
vi.mock('@/components/agent/icons/AgentIcon', () => ({
  AgentIcon: () => null
}))
vi.mock('@/hooks/useResetCountdownClock', () => ({ useResetCountdownClock: () => 0 }))
vi.mock('@/components/ui/dropdown-menu', () => ({ DropdownMenuItem: () => null }))
vi.mock('@/components/settings/form-controls/SettingsFormControls', () => ({
  SettingsSegmentedControl: () => null
}))

const FIVE_HOURS = 300
const WEEK = 10_080

function pool(
  group: string | undefined,
  windowMinutes: number,
  overrides: Partial<RateLimitBucket> = {}
): RateLimitBucket {
  const windowName = windowMinutes === FIVE_HOURS ? '5h Limit Remaining' : 'Weekly Limit Remaining'
  return {
    name: group ? `${group} · ${windowName}` : 'Pro',
    ...(group ? { group, windowName } : {}),
    usedPercent: 0,
    windowMinutes,
    resetsAt: null,
    resetDescription: null,
    ...overrides
  }
}

const TWO_GROUPS = [
  pool('Gemini Models', FIVE_HOURS),
  pool('Gemini Models', WEEK),
  pool('Claude and GPT models', FIVE_HOURS),
  pool('Claude and GPT models', WEEK)
]

describe('pool labels', () => {
  it('shortens two groups with two windows each', () => {
    expect(TWO_GROUPS.map((b) => formatPoolShortLabel(b, TWO_GROUPS))).toEqual([
      '5h',
      'wk',
      'Other Models 5h',
      'Other Models wk'
    ])
  })

  it('labels a single-window group by its window length', () => {
    const buckets = [pool('Gemini Models', WEEK, { name: 'Gemini Models' })]
    expect(formatPoolShortLabel(buckets[0], buckets)).toBe('wk')
  })

  it('uses agy’s window name without "Limit Remaining" for an unknown window', () => {
    const daily = pool('Gemini Models', 0, { windowName: 'Daily Limit Remaining' })
    expect(formatPoolShortLabel(daily, [daily])).toBe('Daily')
  })

  it('does not invent a label for an unknown primary window with no name', () => {
    const { windowName: _windowName, ...unnamed } = pool('Gemini Models', 0)
    expect(formatPoolShortLabel(unnamed, [unnamed])).toBe('')
    expect(formatPoolWindowLabel(unnamed)).toBe('')
  })

  it('passes a group name the rule does not match through', () => {
    const buckets = [pool('Gemini Models', WEEK), pool('Gemini models (Preview)', WEEK)]
    expect(buckets.map((b) => formatPoolShortLabel(b, buckets))).toEqual([
      'wk',
      'Gemini models (Preview) wk'
    ])
  })

  it('shortens known pools from an old host without group fields', () => {
    const legacy = pool(undefined, WEEK, { name: 'Gemini Models · Weekly Limit Remaining' })
    expect(formatPoolShortLabel(legacy, [legacy])).toBe('wk')
    const other = { ...legacy, name: 'Claude and GPT models · Weekly Limit Remaining' }
    expect(formatPoolShortLabel(other, [legacy, other])).toBe('Other Models wk')
    const daily = { ...legacy, name: 'Gemini Models · Daily Limit Remaining', windowMinutes: 0 }
    expect(formatPoolShortLabel(daily, [daily])).toBe('Daily')
  })
})

describe('formatStatusBarSectionLabel', () => {
  it('labels a tie with the pool, not the derived weekly section', () => {
    const buckets = [
      pool('Gemini Models', FIVE_HOURS, { usedPercent: 30 }),
      pool('Gemini Models', WEEK, { usedPercent: 50 }),
      pool('Claude and GPT models', WEEK, { usedPercent: 10 })
    ]
    const p: ProviderRateLimits = {
      provider: 'antigravity',
      session: null,
      // Derived from the pools, so it ties with the Gemini weekly pool.
      weekly: { usedPercent: 50, windowMinutes: WEEK, resetsAt: null, resetDescription: null },
      buckets,
      updatedAt: 0,
      error: null,
      status: 'ok'
    }

    const tightest = getTightestUsageSection(p)
    expect(tightest?.window).toBe(buckets[1])
    expect(formatStatusBarSectionLabel(p, tightest!)).toBe('wk')
  })
})

describe('getTightestUsageSection', () => {
  it('prefers the weekly window when consumption ties', () => {
    const weekly = { usedPercent: 40, windowMinutes: WEEK, resetsAt: null, resetDescription: null }
    const p: ProviderRateLimits = {
      provider: 'codex',
      session: { ...weekly, windowMinutes: FIVE_HOURS },
      weekly,
      updatedAt: 0,
      error: null,
      status: 'ok'
    }

    expect(getTightestUsageSection(p)?.window).toBe(weekly)
  })
})
