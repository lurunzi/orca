// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { ProviderSegment } from './StatusBarProviderSegment'

vi.mock('@/i18n/i18n', () => ({
  i18n: { language: 'en' },
  translate: (_key: string, fallback: string, values: Record<string, string> = {}) =>
    Object.entries(values).reduce(
      (text, [key, value]) => text.replace(`{{${key}}}`, value),
      fallback
    )
}))
vi.mock('@/components/agent/icons/AgentIcon', () => ({
  AgentIcon: () => null
}))

const START = Date.UTC(2026, 9, 8, 12)
const MINUTE = 60_000

function limits(usedPercent = 90): ProviderRateLimits {
  return {
    provider: 'antigravity',
    session: null,
    weekly: null,
    buckets: [
      {
        name: 'Gemini Models · 5h Limit Remaining',
        group: 'Gemini Models',
        windowName: '5h Limit Remaining',
        usedPercent,
        windowMinutes: 300,
        resetsAt: START + 90 * MINUTE + 30_000,
        resetDescription: null
      }
    ],
    status: 'ok',
    error: null,
    updatedAt: START
  }
}

describe('status-bar pool countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it.each(['verbose', 'compact'] as const)(
    'identifies the limiting window when both pools reset together in %s mode',
    (mode) => {
      const p = limits()
      p.buckets?.push({
        name: 'Gemini Models · Weekly Limit Remaining',
        group: 'Gemini Models',
        windowName: 'Weekly Limit Remaining',
        usedPercent: 95,
        windowMinutes: 10_080,
        resetsAt: START + 90 * MINUTE + 30_000,
        resetDescription: null
      })
      const { container } = render(
        <ProviderSegment p={p} compact={false} mode={mode} display="remaining" />
      )

      if (mode === 'verbose') {
        expect(container.textContent).toContain('10% 5h (1h 30m)')
        expect(container.textContent).toContain('5% wk (1h 30m)')
      } else {
        expect(container.textContent).toBe('5% wk (1h 30m)')
      }
    }
  )
})
