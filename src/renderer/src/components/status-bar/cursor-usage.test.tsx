// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { ProviderSegment } from './StatusBarProviderSegment'
import { getVisibleUsageProvider, isUsageEmptyState } from './status-bar-provider-visibility'
import { getProviderUsageErrorMessage } from './usage-error-copy'
import { getWindowSections } from './tooltip'

vi.mock('@/lib/agent-catalog', () => ({
  AgentIcon: ({ agent }: { agent: string }) => <span data-agent={agent} />
}))
vi.mock('@/hooks/useResetCountdownClock', () => ({ useResetCountdownClock: () => 0 }))

const cursor: ProviderRateLimits = {
  provider: 'cursor',
  session: null,
  weekly: null,
  monthly: { usedPercent: 68.65, windowMinutes: 44_640, resetsAt: null, resetDescription: null },
  updatedAt: 1,
  error: null,
  status: 'ok'
}

describe('Cursor status-bar usage', () => {
  it('renders the existing percentage chip with the Cursor icon for used and remaining modes', () => {
    const used = renderToStaticMarkup(
      <ProviderSegment p={cursor} compact={false} display="used" mode="compact" />
    )
    const remaining = renderToStaticMarkup(
      <ProviderSegment p={cursor} compact={false} display="remaining" mode="compact" />
    )
    expect(used).toContain('data-agent="cursor"')
    expect(used).toContain('69%')
    expect(remaining).toContain('31%')
    expect(getWindowSections(cursor).filter((section) => section.window)).toEqual([
      { label: 'Monthly', window: cursor.monthly }
    ])
  })
  it('hides missing credentials and absent older-host fields, but keeps failed configured accounts visible', () => {
    expect(getVisibleUsageProvider('cursor', undefined, {})).toBeNull()
    expect(
      getVisibleUsageProvider('cursor', { ...cursor, monthly: null, status: 'unavailable' }, {})
    ).toBeNull()
    expect(getVisibleUsageProvider('cursor', { ...cursor, status: 'error' }, {})?.monthly).toEqual(
      cursor.monthly
    )
  })
  it('does not show the empty setup prompt when Cursor is the only configured provider', () => {
    const unavailable = { ...cursor, monthly: null, status: 'unavailable' } as const
    const others = {
      claude: unavailable,
      codex: unavailable,
      gemini: unavailable,
      opencodeGo: unavailable,
      kimi: unavailable,
      antigravity: unavailable,
      minimax: unavailable,
      grok: unavailable
    }
    expect(isUsageEmptyState({ ...others, cursor }, {})).toBe(false)
    expect(isUsageEmptyState(others, {})).toBe(true)
  })
  it('explains expired sign-in without offering an unrelated Orca account setting', () => {
    expect(
      getProviderUsageErrorMessage({
        ...cursor,
        status: 'error',
        usageMetadata: { failureKind: 'stale-token' }
      })
    ).toContain('Open Cursor or run agent login')
  })
})
