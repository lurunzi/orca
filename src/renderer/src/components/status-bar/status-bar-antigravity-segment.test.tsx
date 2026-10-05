import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits, RateLimitWindow } from '../../../../shared/rate-limit-types'

vi.mock('@/i18n/i18n', () => ({
  i18n: { language: 'en' },
  translate: (_key: string, fallback: string, values?: Record<string, string>) => {
    let result = fallback
    for (const [key, value] of Object.entries(values ?? {})) {
      result = result.replace(`{{${key}}}`, value)
    }
    return result
  }
}))

vi.mock('@/lib/agent-catalog', () => ({
  AgentIcon: () => null
}))

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { usagePercentageDisplay: 'used' | 'remaining' }) => unknown) =>
    selector({ usagePercentageDisplay: 'used' })
}))

const WEEKLY_MINUTES = 10_080

function weeklyWindow(usedPercent: number): RateLimitWindow {
  return { usedPercent, windowMinutes: WEEKLY_MINUTES, resetsAt: null, resetDescription: null }
}

/**
 * The record `agy -p "/usage"` produces for a tier metered weekly only, with the Gemini pool
 * genuinely exhausted — captured from agy 1.2.11.
 */
function antigravityLimits(overrides: Partial<ProviderRateLimits> = {}): ProviderRateLimits {
  return {
    provider: 'antigravity',
    session: null,
    weekly: weeklyWindow(100),
    buckets: [
      { name: 'Gemini Models', ...weeklyWindow(100) },
      { name: 'Claude and GPT models', ...weeklyWindow(0) }
    ],
    updatedAt: Date.now(),
    error: null,
    status: 'ok',
    ...overrides
  }
}

describe('Antigravity status-bar segment', () => {
  it.each([
    [10, 5, 10, 'wk'],
    [10, 10, 10, 'wk'],
    [10, 25, 25, '5h'],
    [0, 0, 0, 'wk']
  ] as const)(
    'selects Gemini weekly %s / hourly %s without model-group labels',
    async (weekly, hourly, expected, label) => {
      const { ProviderSegment } = await import('./StatusBar')
      const p = antigravityLimits({
        weekly: weeklyWindow(100),
        buckets: [
          {
            name: 'Gemini Models · Five Hour Limit Remaining',
            ...weeklyWindow(hourly),
            windowMinutes: 300
          },
          { name: 'Gemini Models · Weekly Limit Remaining', ...weeklyWindow(weekly) },
          { name: 'Claude and GPT models', ...weeklyWindow(100) }
        ]
      })
      for (const display of ['used', 'remaining'] as const) {
        const markup = renderToStaticMarkup(
          <ProviderSegment p={p} compact={false} display={display} mode="compact" />
        )
        const shown = display === 'used' ? expected : 100 - expected
        expect(markup).toContain(`${shown}% ${display === 'used' ? 'used' : 'left'} ${label}`)
        expect(markup).not.toContain('Models')
        expect(markup).not.toContain('Limit Remaining')
        expect(markup).not.toContain('Claude')
      }
    }
  )

  it('shows the Gemini reset countdown and handles a weekly-only tier', async () => {
    const { ProviderSegment } = await import('./StatusBar')
    const markup = renderToStaticMarkup(
      <ProviderSegment
        p={antigravityLimits({
          buckets: [{ name: 'Gemini Models', ...weeklyWindow(10), resetsAt: Date.now() + 90_000 }]
        })}
        compact={false}
        display="used"
        mode="compact"
      />
    )
    expect(markup).toContain('10% used 1m')
  })

  it('does not substitute another model group when Gemini is absent', async () => {
    const { getUsageHeadlineSection } = await import('./UsageRosterPanel')
    expect(
      getUsageHeadlineSection(
        antigravityLimits({ buckets: [{ name: 'Claude and GPT models', ...weeklyWindow(100) }] })
      )
    ).toBeNull()
  })

  it('prefers weekly on ties in legacy readings without buckets', async () => {
    const { getUsageHeadlineSection } = await import('./UsageRosterPanel')
    const headline = getUsageHeadlineSection(
      antigravityLimits({
        buckets: [],
        session: { ...weeklyWindow(100), windowMinutes: 300 }
      })
    )
    expect(headline?.label).toBe('wk')
  })

  it('renders only Gemini usage with concise window labels', async () => {
    const { ProviderSegment } = await import('./StatusBar')
    const markup = renderToStaticMarkup(
      <ProviderSegment p={antigravityLimits()} compact={false} display="used" mode="verbose" />
    )

    expect(markup).not.toContain('Gemini Models')
    expect(markup).not.toContain('Claude and GPT models')
    expect(markup).toContain('100% used wk')
  })

  it('shows the weekly window when a tier reports no session pool', async () => {
    // Why: the verbose fallback chain was `session ?? monthly`, so a weekly-only provider with a
    // real limit rendered an empty segment.
    const { ProviderSegment } = await import('./StatusBar')
    const markup = renderToStaticMarkup(
      <ProviderSegment
        p={antigravityLimits({ buckets: [] })}
        compact={false}
        display="used"
        mode="verbose"
      />
    )

    expect(markup).toContain('100%')
  })

  it('still renders a reading when only the weekly window is known', async () => {
    const { ProviderSegment } = await import('./StatusBar')
    const markup = renderToStaticMarkup(
      <ProviderSegment
        p={antigravityLimits({ buckets: undefined })}
        compact={false}
        display="used"
        mode="verbose"
      />
    )

    expect(markup).toContain('100%')
  })

  it('does not widen the allowlist for providers that rely on it', async () => {
    // Why: Gemini's experimental buckets are still filtered; only providers whose buckets are the
    // whole meter bypass the allowlist.
    const { ProviderSegment } = await import('./StatusBar')
    const markup = renderToStaticMarkup(
      <ProviderSegment
        p={{
          provider: 'gemini',
          session: weeklyWindow(12),
          weekly: null,
          buckets: [
            { name: 'Pro', ...weeklyWindow(30) },
            { name: 'Some Experimental Model', ...weeklyWindow(80) }
          ],
          updatedAt: Date.now(),
          error: null,
          status: 'ok'
        }}
        compact={false}
        display="used"
        mode="verbose"
      />
    )

    expect(markup).toContain('Pro')
    expect(markup).not.toContain('Some Experimental Model')
  })
})
