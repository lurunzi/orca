import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../../shared/agent-usage/rate-limits/rate-limit-types'
import { watchClaudeCredentials } from '../claude-credential-watcher'
import { fetchActiveClaudeRateLimits } from '../providers/claude/claude-active-usage-fetch'
import { fetchCodexRateLimits } from '../providers/codex/codex-fetcher'
import { RateLimitService } from './rate-limit-service'

const { unavailable } = vi.hoisted(() => ({
  unavailable:
    (provider: ProviderRateLimits['provider']) => async (): Promise<ProviderRateLimits> => ({
      provider,
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      error: null,
      status: 'unavailable'
    })
}))

vi.mock('../claude-credential-watcher', () => ({ watchClaudeCredentials: vi.fn(() => vi.fn()) }))
vi.mock('../providers/claude/claude-active-usage-fetch', () => ({
  fetchActiveClaudeRateLimits: vi.fn()
}))
vi.mock('../providers/claude/claude-managed-account-usage', () => ({
  fetchInactiveClaudeAccountUsage: vi.fn()
}))
vi.mock('../providers/codex/codex-fetcher', () => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  fetchCodexRateLimits: vi.fn(unavailable('codex'))
}))
vi.mock('../providers/gemini/gemini-usage-fetcher', () => ({
  fetchGeminiRateLimits: unavailable('gemini')
}))
vi.mock('../providers/opencode-go/opencode-go-usage-source-selection', () => ({
  fetchOpenCodeGoUsage: unavailable('opencode-go')
}))
vi.mock('../providers/kimi/kimi-fetcher', () => ({ fetchKimiRateLimits: unavailable('kimi') }))
vi.mock('../providers/minimax/minimax-fetcher', () => ({
  fetchMiniMaxRateLimits: unavailable('minimax')
}))
vi.mock('../providers/grok/grok-fetcher', () => ({ fetchGrokRateLimits: unavailable('grok') }))
vi.mock('../providers/grok/grok-auth', () => ({
  readGrokAuthSession: () => ({ status: 'missing' })
}))
vi.mock('../providers/cursor/cursor-fetcher', () => ({
  fetchCursorRateLimits: unavailable('cursor')
}))
vi.mock('../providers/cursor/cursor-auth', () => ({
  readCursorAuthSession: async () => ({ status: 'missing' })
}))
vi.mock('../providers/zcode/zcode-usage-fetcher', () => ({
  fetchZcodeRateLimits: unavailable('zcode')
}))
vi.mock('../providers/antigravity/antigravity-usage-fetcher', () => ({
  fetchAntigravityRateLimits: unavailable('antigravity')
}))
vi.mock('../providers/muse/muse-usage-fetcher', () => ({
  fetchMuseRateLimits: unavailable('muse')
}))
vi.mock('../../minimax/minimax-cookie-store', () => ({
  hasMiniMaxSessionCookie: async () => false
}))
vi.mock('../../minimax/minimax-api-key-store', () => ({ hasMiniMaxApiKey: async () => false }))
vi.mock('../../zcode/zcode-plan-api-key-store', () => ({ hasZcodePlanApiKey: async () => false }))

function claudeUsage(usedPercent: number): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: Date.now(),
    error: null,
    status: 'ok'
  }
}

function claudeError(message: string): ProviderRateLimits {
  return {
    provider: 'claude',
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error: message,
    status: 'error'
  }
}

async function flushMicrotasks(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}

// Fork: a Claude login outside Orca refreshes usage from the credential file watch.
describe('Claude credential-change recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Only the clock is fixed; the service's own timers stay real.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('retries after external login without waiting for focus or the polling interval', async () => {
    vi.mocked(fetchActiveClaudeRateLimits)
      .mockResolvedValueOnce(claudeError('stale token'))
      .mockResolvedValue(claudeUsage(32))
    const service = new RateLimitService()
    await service.refresh()
    service.start({ fetchImmediately: false })
    try {
      const onChange = vi.mocked(watchClaudeCredentials).mock.calls.at(-1)?.[1]
      expect(onChange).toBeTypeOf('function')
      onChange?.()
      await vi.waitFor(async () => expect((await service.getState()).claude?.status).toBe('ok'))
      expect(fetchActiveClaudeRateLimits).toHaveBeenCalledTimes(2)
      expect(fetchCodexRateLimits).toHaveBeenCalledTimes(1)
      onChange?.()
      await flushMicrotasks()
      expect(fetchActiveClaudeRateLimits).toHaveBeenCalledTimes(2)
    } finally {
      service.stop()
    }
  })

  it('fences an old-token result and queues one retry behind the active cycle', async () => {
    const old = Promise.withResolvers<ProviderRateLimits>()
    vi.mocked(fetchActiveClaudeRateLimits)
      .mockResolvedValueOnce(claudeError('stale token'))
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(claudeUsage(17))
    const service = new RateLimitService()
    await service.refresh()
    service.start({ fetchImmediately: false })
    try {
      const pending = service.refresh()
      await vi.waitFor(() => expect(fetchActiveClaudeRateLimits).toHaveBeenCalledTimes(2))
      vi.mocked(watchClaudeCredentials).mock.calls.at(-1)?.[1]()
      old.resolve(claudeError('old token rejected'))
      await pending
      expect(fetchActiveClaudeRateLimits).toHaveBeenCalledTimes(3)
      expect((await service.getState()).claude?.session?.usedPercent).toBe(17)
    } finally {
      service.stop()
    }
  })

  it('disposes the host watch on a WSL switch and ignores its late event after stop', async () => {
    vi.mocked(fetchActiveClaudeRateLimits).mockResolvedValue(claudeError('stale token'))
    const service = new RateLimitService()
    await service.refresh()
    service.start({ fetchImmediately: false })
    const onChange = vi.mocked(watchClaudeCredentials).mock.calls.at(-1)?.[1]
    const close = vi.mocked(watchClaudeCredentials).mock.results.at(-1)?.value
    service.setClaudeFetchTarget({ runtime: 'wsl', wslDistro: 'Ubuntu' })
    expect(close).toHaveBeenCalledTimes(1)
    onChange?.()
    service.stop()
    onChange?.()
    await flushMicrotasks()
    expect(fetchActiveClaudeRateLimits).toHaveBeenCalledTimes(1)
  })
})
