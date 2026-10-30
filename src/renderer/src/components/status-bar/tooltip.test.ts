import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import type * as ReactModule from 'react'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'

vi.mock('@/lib/agent-catalog', async () => {
  const ReactActual = await vi.importActual<typeof ReactModule>('react')
  return {
    AgentIcon: ({ agent }: { agent: string }) =>
      ReactActual.createElement('span', { 'data-agent-icon': agent })
  }
})

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) => {
    let result = fallback
    for (const [key, value] of Object.entries(values ?? {})) {
      result = result.replace(`{{${key}}}`, value)
    }
    return result
  }
}))

import {
  barColor,
  clampUsedPercent,
  formatResetCreditExpiry,
  formatResetCountdown,
  getExtraUsageLabel,
  getWindowSections,
  ProviderIcon,
  ProviderPanel
} from './tooltip'

function provider(overrides: Partial<ProviderRateLimits> = {}): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: 0,
    error: null,
    status: 'error',
    ...overrides
  }
}

const PROVIDER_IDS: ProviderRateLimits['provider'][] = [
  'claude',
  'codex',
  'gemini',
  'antigravity',
  'opencode-go',
  'kimi',
  'minimax',
  'grok',
  'zcode'
]

afterEach(() => {
  vi.useRealTimers()
})

describe('formatResetCountdown', () => {
  it('uses natural copy when the reset time has arrived', () => {
    expect(formatResetCountdown(0)).toBe('Resets now')
    expect(formatResetCountdown(-1)).toBe('Resets now')
  })

  it('keeps the "in" preposition for future reset times', () => {
    expect(formatResetCountdown(12 * 60 * 60_000 + 41 * 60_000)).toBe('Resets in 12h 41m')
  })
})

describe('formatResetCreditExpiry', () => {
  it('shows singular and plural expiry countdowns', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T12:00:00Z'))

    expect(formatResetCreditExpiry(Date.parse('2026-06-20T14:30:00Z'), 1)).toBe('Expires in 2h 30m')
    expect(formatResetCreditExpiry(Date.parse('2026-06-25T12:00:00Z'), 2)).toBe(
      'Next expires in 5d'
    )
  })

  it('omits expiry copy when the backend has not reported an expiry', () => {
    expect(formatResetCreditExpiry(null, 1)).toBeNull()
  })
})

describe('getWindowSections', () => {
  it('keeps ZCode Coding Plan windows separate from MCP quota', () => {
    const session = { usedPercent: 25, windowMinutes: 300, resetsAt: null, resetDescription: null }
    const weekly = { usedPercent: 40, windowMinutes: 10080, resetsAt: null, resetDescription: null }
    const mcp = { usedPercent: 10, windowMinutes: 43200, resetsAt: null, resetDescription: null }
    const sections = getWindowSections(
      provider({ provider: 'zcode', session, weekly, monthly: mcp })
    )

    expect(sections.map((section) => section.label)).toEqual(['Session', 'Weekly', 'MCP'])
    expect(sections[2].window).toBe(mcp)
  })

  it('returns buckets as sections when present', () => {
    const p: ProviderRateLimits = {
      provider: 'gemini',
      session: { usedPercent: 80, windowMinutes: 300, resetsAt: null, resetDescription: null },
      weekly: null,
      buckets: [
        {
          name: 'Pro',
          usedPercent: 30,
          windowMinutes: 300,
          resetsAt: null,
          resetDescription: null
        },
        {
          name: 'Flash',
          usedPercent: 80,
          windowMinutes: 300,
          resetsAt: null,
          resetDescription: null
        }
      ],
      updatedAt: Date.now(),
      error: null,
      status: 'ok'
    }
    const sections = getWindowSections(p)
    expect(sections).toEqual([
      { label: 'Pro', window: p.buckets![0] },
      { label: 'Flash', window: p.buckets![1] },
      { label: 'Weekly', window: null }
    ])
  })

  it('returns session and weekly when buckets are absent', () => {
    const p: ProviderRateLimits = {
      provider: 'claude',
      session: { usedPercent: 40, windowMinutes: 300, resetsAt: null, resetDescription: null },
      weekly: { usedPercent: 20, windowMinutes: 10080, resetsAt: null, resetDescription: null },
      updatedAt: Date.now(),
      error: null,
      status: 'ok'
    }
    const sections = getWindowSections(p)
    expect(sections).toEqual([
      { label: 'Session', window: p.session },
      { label: 'Weekly', window: p.weekly }
    ])
  })

  it('returns a separate Fable section when Claude reports Fable weekly usage', () => {
    const p: ProviderRateLimits = {
      provider: 'claude',
      session: { usedPercent: 40, windowMinutes: 300, resetsAt: null, resetDescription: null },
      weekly: { usedPercent: 20, windowMinutes: 10080, resetsAt: null, resetDescription: null },
      fableWeekly: {
        usedPercent: 42,
        windowMinutes: 10080,
        resetsAt: null,
        resetDescription: null
      },
      updatedAt: Date.now(),
      error: null,
      status: 'ok'
    }
    const sections = getWindowSections(p)
    expect(sections).toEqual([
      { label: 'Session', window: p.session },
      { label: 'Weekly', window: p.weekly },
      { label: 'Fable', window: p.fableWeekly }
    ])
  })

  it('returns session and weekly for empty buckets array', () => {
    const p: ProviderRateLimits = {
      provider: 'gemini',
      session: { usedPercent: 50, windowMinutes: 300, resetsAt: null, resetDescription: null },
      weekly: null,
      buckets: [],
      updatedAt: Date.now(),
      error: null,
      status: 'ok'
    }
    const sections = getWindowSections(p)
    expect(sections).toEqual([
      { label: 'Session', window: p.session },
      { label: 'Weekly', window: null }
    ])
  })

  it('does not expose bucket names via session window in compact rendering path', () => {
    // Compact rendering reads session directly; detail bucket sections must not replace its numeric value.
    const p: ProviderRateLimits = {
      provider: 'gemini',
      session: { usedPercent: 80, windowMinutes: 300, resetsAt: null, resetDescription: null },
      weekly: null,
      buckets: [
        {
          name: 'Pro',
          usedPercent: 30,
          windowMinutes: 300,
          resetsAt: null,
          resetDescription: null
        },
        {
          name: 'Flash',
          usedPercent: 80,
          windowMinutes: 300,
          resetsAt: null,
          resetDescription: null
        }
      ],
      updatedAt: Date.now(),
      error: null,
      status: 'ok'
    }
    expect(p.session?.usedPercent).toBe(80)
    const sections = getWindowSections(p)
    const labels = sections.map((s) => s.label)
    expect(labels).toContain('Pro')
    expect(labels).toContain('Flash')
    expect(labels).not.toContain('Session')
  })

  it('preserves reset metadata inside bucket windows', () => {
    const p: ProviderRateLimits = {
      provider: 'gemini',
      session: null,
      weekly: null,
      buckets: [
        {
          name: 'Pro',
          usedPercent: 45,
          windowMinutes: 300,
          resetsAt: 18000000,
          resetDescription: '5:00 PM'
        }
      ],
      updatedAt: Date.now(),
      error: null,
      status: 'ok'
    }
    const sections = getWindowSections(p)
    expect(sections).toHaveLength(2)
    expect(sections[0].label).toBe('Pro')
    expect(sections[0].window!.resetsAt).toBe(18000000)
    expect(sections[0].window!.resetDescription).toBe('5:00 PM')
  })
})

describe('getExtraUsageLabel', () => {
  it('names the balance per provider', () => {
    expect(getExtraUsageLabel('claude')).toBe('Usage credits')
    expect(getExtraUsageLabel('opencode-go')).toBe('Zen balance')
    expect(getExtraUsageLabel('codex')).toBe('Credits')
    expect(getExtraUsageLabel('gemini')).toBe('Balance')
  })
})

describe('ProviderPanel extra-usage rendering', () => {
  it('renders the Claude usage-credits cap as a spent/limit meter plus balance', () => {
    const p = provider({
      status: 'ok',
      session: { usedPercent: 100, windowMinutes: 300, resetsAt: null, resetDescription: null },
      extraUsage: {
        balance: 10,
        unit: 'currency',
        currencyCode: 'EUR',
        enabled: true,
        disabledReason: null,
        spent: 50,
        spendLimit: 2000,
        spentPercent: 2.5,
        resetsAt: null
      }
    })

    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))

    expect(markup).toContain('Usage credits')
    expect(markup).toContain('€2,000.00')
    expect(markup).toContain('€50.00')
    expect(markup).toContain('% used')
    expect(markup).toContain('Balance €10.00')
  })

  it('renders a legacy spend cap without presenting an unavailable balance as zero', () => {
    const p = provider({
      status: 'ok',
      session: { usedPercent: 100, windowMinutes: 300, resetsAt: null, resetDescription: null },
      extraUsage: {
        balance: null,
        unit: 'currency',
        currencyCode: 'EUR',
        enabled: true,
        disabledReason: null,
        spent: 50,
        spendLimit: 2000,
        spentPercent: 2.5,
        resetsAt: null
      }
    })

    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))

    expect(markup).toContain('Usage credits')
    expect(markup).toContain('€50.00 / €2,000.00')
    expect(markup).not.toContain('Balance €0.00')
  })

  it('renders a known legacy cap without inventing spend, percent, balance, or a meter', () => {
    const p = provider({
      status: 'ok',
      extraUsage: {
        balance: null,
        unit: 'currency',
        currencyCode: 'EUR',
        enabled: true,
        disabledReason: null,
        spent: null,
        spendLimit: 2000,
        spentPercent: null,
        resetsAt: null
      }
    })

    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))

    expect(markup).toContain('Usage credits')
    expect(markup).toContain('Limit €2,000.00')
    expect(markup).not.toContain('€0.00')
    expect(markup).not.toContain('% used')
    expect(markup).not.toContain('h-[6px]')
  })

  it('keeps a known cap as a caption when spend is unknown even if a percentage is present', () => {
    const p = provider({
      status: 'ok',
      extraUsage: {
        balance: null,
        unit: 'currency',
        currencyCode: 'EUR',
        enabled: true,
        disabledReason: null,
        spent: null,
        spendLimit: 2000,
        spentPercent: 10,
        resetsAt: null
      }
    })
    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))
    expect(markup).toContain('Limit €2,000.00')
    expect(markup).not.toContain('€0.00')
    expect(markup).not.toContain('% used')
    expect(markup).not.toContain('h-[6px]')
  })

  it('renders a disabled, out-of-credits cap with a zero balance', () => {
    const p = provider({
      status: 'ok',
      session: { usedPercent: 100, windowMinutes: 300, resetsAt: null, resetDescription: null },
      extraUsage: {
        balance: 0,
        unit: 'currency',
        currencyCode: 'EUR',
        enabled: false,
        disabledReason: 'out_of_credits',
        spent: 0,
        spendLimit: 2000,
        spentPercent: 0,
        resetsAt: null
      }
    })

    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))

    expect(markup).toContain('Usage credits')
    expect(markup).toContain('€0.00 / €2,000.00')
    expect(markup).toContain('Balance €0.00')
  })

  it('renders an uncapped OpenCode Go balance as a plain available amount', () => {
    const p = provider({
      provider: 'opencode-go',
      status: 'ok',
      session: { usedPercent: 20, windowMinutes: 300, resetsAt: null, resetDescription: null },
      extraUsage: {
        balance: 12.4,
        unit: 'currency',
        currencyCode: 'USD',
        enabled: true,
        disabledReason: null,
        spent: null,
        spendLimit: null,
        spentPercent: null,
        resetsAt: null
      }
    })

    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))

    expect(markup).toContain('Zen balance')
    expect(markup).toContain('$12.40')
    expect(markup).toContain('available')
  })

  it.each([0, -1.25])('keeps a depleted Zen balance of %s visible in the popover', (balance) => {
    const p = provider({
      provider: 'opencode-go',
      status: 'ok',
      session: { usedPercent: 100, windowMinutes: 300, resetsAt: null, resetDescription: null },
      extraUsage: {
        balance,
        unit: 'currency',
        currencyCode: 'USD',
        enabled: true,
        disabledReason: null,
        spent: null,
        spendLimit: null,
        spentPercent: null,
        resetsAt: null
      }
    })

    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))

    expect(markup).toContain('Zen balance')
    expect(markup).toContain(
      new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(balance)
    )
    expect(markup).toContain('available')
  })

  it.each([
    ['refresh-failed', 'Refresh failed'],
    ['billing-unavailable', 'Unavailable'],
    ['api-key-source', 'Balance is not included in this usage response.']
  ])('shows an unknown Zen balance honestly for %s', (disabledReason, message) => {
    const p = provider({
      provider: 'opencode-go',
      status: 'ok',
      session: { usedPercent: 20, windowMinutes: 300, resetsAt: null, resetDescription: null },
      extraUsage: {
        balance: null,
        unit: 'currency',
        currencyCode: 'USD',
        enabled: false,
        disabledReason,
        spent: null,
        spendLimit: null,
        spentPercent: null,
        resetsAt: null
      }
    })

    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))

    expect(markup).toContain('Zen balance')
    expect(markup).toContain(message)
    expect(markup).toContain('Session')
    expect(markup).not.toContain('$0.00')
    expect(markup).not.toMatch(/\$[\d,.]+ available/)
  })

  it('renders a Codex credit count as a plain "N credits available" line', () => {
    const p = provider({
      provider: 'codex',
      status: 'ok',
      session: { usedPercent: 20, windowMinutes: 300, resetsAt: null, resetDescription: null },
      extraUsage: {
        balance: 500,
        unit: 'credits',
        unlimited: false,
        enabled: true,
        disabledReason: null,
        resetsAt: null
      }
    })

    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))

    expect(markup).toContain('Credits')
    expect(markup).toContain('500 credits available')
    expect(markup).not.toContain('$500')
  })

  it('renders unlimited Codex credits as "Unlimited"', () => {
    const p = provider({
      provider: 'codex',
      status: 'ok',
      session: { usedPercent: 20, windowMinutes: 300, resetsAt: null, resetDescription: null },
      extraUsage: {
        balance: 0,
        unit: 'credits',
        unlimited: true,
        enabled: true,
        disabledReason: null,
        resetsAt: null
      }
    })

    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))

    expect(markup).toContain('Unlimited')
  })

  it('omits the balance row when no extra usage is reported', () => {
    const p = provider({
      status: 'ok',
      session: { usedPercent: 40, windowMinutes: 300, resetsAt: null, resetDescription: null }
    })

    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))

    expect(markup).not.toContain('Usage credits')
    expect(markup).not.toContain('Zen balance')
  })
})

describe('ProviderPanel reset rendering', () => {
  it('renders the Fable reset countdown when Claude reports a reset timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 3, 20, 0))
    const p = provider({
      status: 'ok',
      session: null,
      weekly: null,
      fableWeekly: {
        usedPercent: 62,
        windowMinutes: 10080,
        resetsAt: Date.now() + (6 * 24 + 17) * 60 * 60_000,
        resetDescription: 'Jul 10 at 1:00 PM'
      }
    })

    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))

    expect(markup).toContain('Fable')
    expect(markup).toContain('Resets in 6d 17h')
  })

  it('renders MiniMax session as usedPercent so the value matches the bar', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 4, 15, 0))
    const p = provider({
      provider: 'minimax',
      status: 'ok',
      session: {
        usedPercent: 35,
        windowMinutes: 300,
        resetsAt: Date.now() + 2 * 60 * 60_000,
        resetDescription: null
      }
    })

    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))

    expect(markup).toContain('35%')
    expect(markup).toContain('% used')
    expect(markup).not.toContain('% left')
  })

  it('clamps MiniMax session to 100% used when usedPercent reports 100', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 4, 15, 0))
    const p = provider({
      provider: 'minimax',
      status: 'ok',
      session: {
        usedPercent: 100,
        windowMinutes: 300,
        resetsAt: Date.now() + 2 * 60 * 60_000,
        resetDescription: null
      }
    })

    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))

    expect(markup).toContain('100%')
    expect(markup).toContain('% used')
  })

  it('clamps over-100 usedPercent to 100% used in the panel', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 4, 15, 0))
    const p = provider({
      provider: 'minimax',
      status: 'ok',
      session: {
        usedPercent: 140,
        windowMinutes: 300,
        resetsAt: Date.now() + 2 * 60 * 60_000,
        resetDescription: null
      }
    })

    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))

    expect(markup).toContain('100%')
    expect(markup).toContain('width:100%')
    expect(markup).not.toContain('140%')
  })

  it.each(PROVIDER_IDS)('applies remaining copy and meter fill to %s', (providerId) => {
    const p = provider({
      provider: providerId,
      status: 'ok',
      session: {
        usedPercent: 25,
        windowMinutes: 300,
        resetsAt: null,
        resetDescription: null
      }
    })

    const markup = renderToStaticMarkup(
      createElement(ProviderPanel, { p, usagePercentageDisplay: 'remaining' })
    )

    expect(markup).toContain('75% left')
    expect(markup).toContain('width:75%')
    expect(markup).not.toContain('width:25%')
  })
})

describe('clampUsedPercent', () => {
  it('rounds and clamps into 0–100', () => {
    expect(clampUsedPercent(-3)).toBe(0)
    expect(clampUsedPercent(32.4)).toBe(32)
    expect(clampUsedPercent(32.6)).toBe(33)
    expect(clampUsedPercent(100)).toBe(100)
    expect(clampUsedPercent(140)).toBe(100)
  })
})

describe('barColor', () => {
  // Keep low consumption neutral so always-visible meters stay quiet until usage approaches a limit.
  it('maps used percent to neutral / yellow / red bands', () => {
    expect(barColor(0)).toBe('bg-muted-foreground/40')
    expect(barColor(59)).toBe('bg-muted-foreground/40')
    expect(barColor(60)).toBe('bg-yellow-500')
    expect(barColor(79)).toBe('bg-yellow-500')
    expect(barColor(80)).toBe('bg-red-500')
    expect(barColor(100)).toBe('bg-red-500')
  })
})

describe('ProviderIcon', () => {
  it('renders the Antigravity agent icon for the antigravity provider', () => {
    const markup = renderToStaticMarkup(createElement(ProviderIcon, { provider: 'antigravity' }))
    expect(markup).toContain('data-agent-icon="antigravity"')
  })

  it('renders the official MiniMax icon asset for the minimax provider', () => {
    // Keep the official asset recognizable and decorative through status-bar and tooltip rendering.
    const markup = renderToStaticMarkup(createElement(ProviderIcon, { provider: 'minimax' }))
    expect(markup.startsWith('<img')).toBe(true)
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toMatch(/src="[^"]+"/)
  })
})
