import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits, RateLimitWindow } from '../../../../shared/rate-limit-types'
import { ProviderSegment } from './StatusBarProviderSegment'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values: Record<string, string> = {}) =>
    Object.entries(values).reduce(
      (text, [key, value]) => text.replace(`{{${key}}}`, value),
      fallback
    )
}))
vi.mock('@/lib/agent-catalog', () => ({ AgentIcon: () => null }))
vi.mock('@/hooks/useResetCountdownClock', () => ({ useResetCountdownClock: () => 0 }))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>
}))
vi.mock('@/components/settings/form-controls/SettingsFormControls', () => ({
  SettingsSegmentedControl: () => null
}))

function windowAt(usedPercent: number): RateLimitWindow {
  return { usedPercent, windowMinutes: 43_200, resetsAt: null, resetDescription: null }
}

function cursorPools(primary: number, other: number): ProviderRateLimits {
  return {
    provider: 'cursor',
    session: null,
    weekly: null,
    monthly: windowAt(12),
    buckets: [
      { name: 'Cursor Models', ...windowAt(primary) },
      { name: 'Other Models', ...windowAt(other) }
    ],
    updatedAt: 0,
    error: null,
    status: 'ok'
  }
}

describe('status-bar reset countdown headline', () => {
  it.each(['claude', 'codex', 'antigravity', 'cursor'] as const)(
    'retains the %s reset countdown when the status bar becomes dense',
    (provider) => {
      const p: ProviderRateLimits = {
        provider,
        session: null,
        weekly: { ...windowAt(22), windowMinutes: 10_080, resetsAt: 90_000 },
        updatedAt: 0,
        status: 'ok',
        error: null
      }
      for (const mode of ['compact', 'verbose'] as const) {
        const render = (now: number) =>
          renderToStaticMarkup(
            <ProviderSegment p={p} compact={true} mode={mode} display="used" now={now} />
          )
        expect(render(0)).toContain('22% 1m')
        expect(render(60_000)).toContain('22% 0m')
        expect(render(90_000)).toContain('22% now')
      }
    }
  )

  it('shows the primary pool reset countdown', () => {
    const p = cursorPools(19, 90)
    p.buckets = p.buckets?.map((bucket) => ({ ...bucket, resetsAt: Date.now() + 90_000 }))
    const segment = renderToStaticMarkup(
      <ProviderSegment p={p} compact={false} mode="compact" display="used" />
    )
    expect(segment).toContain('19% 1m')
    expect(segment).not.toContain('Cursor Models')
  })
})
