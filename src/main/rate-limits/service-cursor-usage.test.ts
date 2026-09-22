import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimitService } from './service'
import { fetchClaudeRateLimits } from './claude-fetcher'
import { fetchCodexRateLimits } from './codex-fetcher'
import { fetchCursorRateLimits } from './cursor-fetcher'
import { fetchGeminiRateLimits } from './gemini-usage-fetcher'
import {
  errorProvider,
  okProvider,
  resetRateLimitProviderMocks
} from './rate-limit-service-test-harness'

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

vi.mock('./opencode-go-usage-fetcher', () => ({
  fetchOpenCodeGoRateLimits: vi.fn()
}))

vi.mock('./minimax/minimax-fetcher', () => ({
  fetchMiniMaxRateLimits: vi.fn()
}))

vi.mock('./grok-fetcher', () => ({
  fetchGrokRateLimits: vi.fn()
}))

vi.mock('./grok-auth', () => ({
  readGrokAuthSession: vi.fn(() => ({ status: 'missing' }))
}))

vi.mock('../minimax/minimax-cookie-store', () => ({
  hasMiniMaxSessionCookie: vi.fn(() => false)
}))

describe('RateLimitService Cursor usage', () => {
  beforeEach(() => {
    resetRateLimitProviderMocks()
    vi.mocked(fetchClaudeRateLimits).mockResolvedValue(okProvider('claude', 7))
    vi.mocked(fetchCodexRateLimits).mockResolvedValue(okProvider('codex', 20))
    vi.mocked(fetchGeminiRateLimits).mockResolvedValue(okProvider('gemini', 0))
  })

  const usage = () => ({
    ...okProvider('cursor', 40),
    session: null,
    monthly: { usedPercent: 40, windowMinutes: 43_200, resetsAt: null, resetDescription: null },
    usageMetadata: { authProvenance: 'identity-a' }
  })

  it('publishes Cursor monthly usage through the existing service snapshot', async () => {
    vi.mocked(fetchCursorRateLimits).mockResolvedValue(usage())
    const service = new RateLimitService()
    await service.refresh()
    expect(service.getState().cursor?.monthly?.usedPercent).toBe(40)
    expect(service.getState().cursor?.session).toBeNull()
  })

  it('retains a transient failure only for the same credential and original timestamp', async () => {
    const original = usage()
    vi.mocked(fetchCursorRateLimits)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce({
        ...errorProvider('cursor', 'Network failure'),
        usageMetadata: { authProvenance: 'identity-a' }
      })
    const service = new RateLimitService()
    await service.refresh()
    await service.refresh()
    expect(service.getState().cursor?.monthly?.usedPercent).toBe(40)
    expect(service.getState().cursor?.updatedAt).toBe(original.updatedAt)
    expect(service.getState().cursor?.status).toBe('error')
  })

  it.each(['changed', 'signed-out', 'rejected'] as const)(
    'clears previous usage when %s',
    async (reason) => {
      vi.mocked(fetchCursorRateLimits)
        .mockResolvedValueOnce(usage())
        .mockResolvedValueOnce({
          ...errorProvider('cursor', 'Authentication failed'),
          usageMetadata:
            reason === 'changed'
              ? { authProvenance: 'identity-b' }
              : reason === 'rejected'
                ? { authProvenance: 'identity-a', failureKind: 'stale-token' }
                : undefined
        })
      const service = new RateLimitService()
      await service.refresh()
      await service.refresh()
      expect(service.getState().cursor?.monthly).toBeUndefined()
    }
  )
})
