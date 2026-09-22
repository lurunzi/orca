import { beforeEach, describe, expect, it, vi } from 'vitest'
import { net } from 'electron'
import { readCursorAuth } from './cursor-auth'
import { fetchCursorRateLimits } from './cursor-fetcher'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))
vi.mock('./cursor-auth', () => ({ readCursorAuth: vi.fn() }))
const auth = {
  status: 'ok',
  cookie: 'WorkosCursorSessionToken=synthetic',
  fingerprint: 'account-a'
} as const
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(readCursorAuth).mockReturnValue(auth)
})

describe('Cursor usage request', () => {
  it('reads the dashboard with bounded cancellation and never publishes the credential', async () => {
    vi.mocked(net.fetch).mockResolvedValue(
      new Response(JSON.stringify({ individualUsage: { plan: { totalPercentUsed: 35 } } }))
    )
    const result = await fetchCursorRateLimits()
    expect(result.monthly?.usedPercent).toBe(35)
    expect(result.session).toBeNull()
    expect(JSON.stringify(result)).not.toContain(auth.cookie)
    expect(net.fetch).toHaveBeenCalledWith(
      'https://cursor.com/api/usage-summary',
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
        headers: { Cookie: auth.cookie, Accept: 'application/json' }
      })
    )
  })
  it('makes no network request without credentials', async () => {
    vi.mocked(readCursorAuth).mockReturnValue({ status: 'missing' })
    expect((await fetchCursorRateLimits()).status).toBe('unavailable')
    expect(net.fetch).not.toHaveBeenCalled()
  })
  it.each([
    [401, 'stale-token'],
    [403, 'stale-token'],
    [429, 'rate-limited'],
    [500, 'server']
  ])('classifies HTTP %s without leaking the response', async (status, kind) => {
    vi.mocked(net.fetch).mockResolvedValue(
      new Response('secret response', { status: Number(status) })
    )
    const result = await fetchCursorRateLimits()
    expect(result.usageMetadata?.failureKind).toBe(kind)
    expect(JSON.stringify(result)).not.toContain('secret response')
  })
  it('does not interpret an unknown payload as unused quota', async () => {
    vi.mocked(net.fetch).mockResolvedValue(new Response('{}'))
    expect((await fetchCursorRateLimits()).usageMetadata?.failureKind).toBe('usage-unavailable')
  })
  it('drops an in-flight result when the account changes', async () => {
    vi.mocked(net.fetch).mockResolvedValue(
      new Response(JSON.stringify({ individualUsage: { plan: { totalPercentUsed: 35 } } }))
    )
    vi.mocked(readCursorAuth)
      .mockReturnValueOnce(auth)
      .mockReturnValueOnce({ ...auth, fingerprint: 'account-b' })
    const result = await fetchCursorRateLimits()
    expect(result.status).toBe('error')
    expect(result.monthly).toBeNull()
    expect(result.usageMetadata?.authProvenance).toBeUndefined()
  })
  it('redacts exceptions and forwards caller cancellation', async () => {
    vi.mocked(net.fetch).mockRejectedValue(new Error(auth.cookie))
    const controller = new AbortController()
    controller.abort()
    const result = await fetchCursorRateLimits({ signal: controller.signal })
    expect(result.error).not.toContain(auth.cookie)
    expect(vi.mocked(net.fetch).mock.calls[0][1]?.signal?.aborted).toBe(true)
  })
  it('honors Retry-After even for manual refreshes and releases it after account changes', async () => {
    vi.mocked(net.fetch).mockResolvedValue(
      new Response('', { status: 429, headers: { 'retry-after': '600' } })
    )
    const first = await fetchCursorRateLimits()
    expect(first.usageMetadata?.retryAtMs).toBeGreaterThan(Date.now())
    const deferred = await fetchCursorRateLimits({ previous: first })
    expect(deferred).toEqual(first)
    expect(net.fetch).toHaveBeenCalledTimes(1)
    vi.mocked(readCursorAuth).mockReturnValue({ ...auth, fingerprint: 'account-b' })
    await fetchCursorRateLimits({ previous: first })
    expect(net.fetch).toHaveBeenCalledTimes(2)
  })
})
