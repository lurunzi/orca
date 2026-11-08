import { watchClaudeCredentials } from './claude-credential-watcher'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { RateLimitService } from './service'
import { fetchClaudeRateLimits } from './claude-fetcher'
import { fetchCodexRateLimits } from './codex-fetcher'
import { fetchZcodeRateLimits } from './zcode-usage-fetcher'
import { fetchOpenCodeGoUsage } from './opencode-go-usage-source-selection'
import {
  deferred,
  errorProvider,
  flushMicrotasks,
  okProvider,
  resetRateLimitProviderMocks
} from './rate-limit-service-test-harness'

vi.mock('./claude-credential-watcher', () => ({ watchClaudeCredentials: vi.fn(() => vi.fn()) }))

vi.mock('./cursor-fetcher', () => ({ fetchCursorRateLimits: vi.fn() }))

vi.mock('./claude-fetcher', () => ({
  fetchClaudeRateLimits: vi.fn(),
  fetchManagedAccountUsage: vi.fn()
}))

vi.mock('./codex-fetcher', () => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  fetchCodexRateLimits: vi.fn()
}))

vi.mock('./gemini-usage-fetcher', () => ({
  fetchGeminiRateLimits: vi.fn()
}))

vi.mock('./kimi-fetcher', () => ({
  fetchKimiRateLimits: vi.fn()
}))

vi.mock('./opencode-go-usage-source-selection', () => ({
  fetchOpenCodeGoUsage: vi.fn()
}))

vi.mock('./zcode-usage-fetcher', () => ({
  fetchZcodeRateLimits: vi.fn()
}))

vi.mock('./antigravity-usage-fetcher', () => ({
  fetchAntigravityRateLimits: vi.fn()
}))

vi.mock('./minimax/minimax-fetcher', () => ({
  fetchMiniMaxRateLimits: vi.fn()
}))

vi.mock('./grok-fetcher', () => ({
  fetchGrokRateLimits: vi.fn()
}))

vi.mock('./cursor-fetcher', () => ({
  fetchCursorRateLimits: vi.fn()
}))

vi.mock('./cursor-auth', () => ({
  readCursorAuthSession: vi.fn()
}))

vi.mock('./grok-auth', () => ({
  readGrokAuthSession: vi.fn(() => ({ status: 'missing' }))
}))

vi.mock('../minimax/minimax-cookie-store', () => ({
  hasMiniMaxSessionCookie: vi.fn(() => false)
}))

describe('RateLimitService', () => {
  beforeEach(() => {
    resetRateLimitProviderMocks()
    vi.mocked(fetchClaudeRateLimits).mockResolvedValue(okProvider('claude', 0, 1_000))
    vi.mocked(fetchCodexRateLimits).mockResolvedValue(okProvider('codex', 0, 1_000))
  })

  it('does not keep a previous ZCode account quota after a failed account switch', async () => {
    vi.mocked(fetchZcodeRateLimits)
      .mockResolvedValueOnce({
        ...okProvider('zcode', 42),
        usageMetadata: { source: 'web', authProvenance: 'account-a' }
      })
      .mockResolvedValueOnce({
        ...errorProvider('zcode', 'request failed'),
        usageMetadata: { source: 'web', authProvenance: 'account-b', failureKind: 'network' }
      })
    const service = new RateLimitService()

    await service.refresh()
    await service.refresh()

    expect(service.getState().zcode?.status).toBe('error')
    expect(service.getState().zcode?.session).toBeNull()
  })

  it('discards stale data when Workspace ID override is changed', async () => {
    const service = new RateLimitService()
    let workspaceId = 'wrk_A'
    service.setOpenCodeGoConfigResolver(() => ({
      sessionCookie: 'session=valid',
      workspaceIdOverride: workspaceId
    }))

    vi.mocked(fetchOpenCodeGoUsage).mockResolvedValue(okProvider('opencode-go', 40, Date.now()))
    await service.refresh()
    expect(service.getState().opencodeGo?.session?.usedPercent).toBe(40)

    workspaceId = 'wrk_B'
    vi.mocked(fetchOpenCodeGoUsage).mockResolvedValue(okProvider('opencode-go', 10, Date.now()))
    await service.refresh()
    expect(service.getState().opencodeGo?.session?.usedPercent).toBe(10)

    // Switching to automatic mode must discard workspace B's data even if the first refresh fails.
    workspaceId = ''
    vi.mocked(fetchOpenCodeGoUsage).mockResolvedValue({
      provider: 'opencode-go',
      session: null,
      weekly: null,
      monthly: null,
      updatedAt: Date.now(),
      error: 'No workspace ID found',
      status: 'error'
    })
    await service.refresh()
    const state = service.getState()
    expect(state.opencodeGo?.status).toBe('error')
    expect(state.opencodeGo?.session).toBeNull()
    expect(state.opencodeGo?.error).toBe('No workspace ID found')
  })
})

describe('Claude credential-change recovery', () => {
  beforeEach(() => resetRateLimitProviderMocks())

  it('retries after external login without waiting for focus or the polling interval', async () => {
    vi.mocked(fetchClaudeRateLimits)
      .mockResolvedValueOnce(errorProvider('claude', 'stale token'))
      .mockResolvedValue(okProvider('claude', 32))
    const service = new RateLimitService()
    await service.refresh()
    service.start({ fetchImmediately: false })
    try {
      const onChange = vi.mocked(watchClaudeCredentials).mock.calls.at(-1)?.[1]
      expect(onChange).toBeTypeOf('function')
      onChange?.()
      await vi.waitFor(() => expect(service.getState().claude?.status).toBe('ok'))
      expect(fetchClaudeRateLimits).toHaveBeenCalledTimes(2)
      expect(fetchCodexRateLimits).toHaveBeenCalledTimes(1)
      onChange?.()
      await flushMicrotasks()
      expect(fetchClaudeRateLimits).toHaveBeenCalledTimes(2)
    } finally {
      service.stop()
    }
  })

  it('fences an old-token result and queues one retry behind the active cycle', async () => {
    const old = deferred<ProviderRateLimits>()
    vi.mocked(fetchClaudeRateLimits)
      .mockResolvedValueOnce(errorProvider('claude', 'stale token'))
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(okProvider('claude', 17))
    const service = new RateLimitService()
    await service.refresh()
    service.start({ fetchImmediately: false })
    try {
      const pending = service.refresh()
      await vi.waitFor(() => expect(fetchClaudeRateLimits).toHaveBeenCalledTimes(2))
      vi.mocked(watchClaudeCredentials).mock.calls.at(-1)?.[1]()
      old.resolve(errorProvider('claude', 'old token rejected'))
      await pending
      expect(fetchClaudeRateLimits).toHaveBeenCalledTimes(3)
      expect(service.getState().claude?.session?.usedPercent).toBe(17)
    } finally {
      service.stop()
    }
  })

  it('disposes the host watch on a WSL switch and ignores its late event after stop', async () => {
    vi.mocked(fetchClaudeRateLimits).mockResolvedValue(errorProvider('claude', 'stale token'))
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
    expect(fetchClaudeRateLimits).toHaveBeenCalledTimes(1)
  })
})
