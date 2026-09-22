import { net } from 'electron'
import { parseRetryAfterMs } from './rate-limit-retry-after'
import type { ProviderRateLimits, UsageRateLimitFailureKind } from '../../shared/rate-limit-types'
import { readCursorAuth, type CursorAuth } from './cursor-auth'
import { parseCursorUsageSummary } from './cursor-usage-summary'

function failure(
  status: 'error' | 'unavailable',
  kind: UsageRateLimitFailureKind,
  error: string,
  auth?: CursorAuth
): ProviderRateLimits {
  return {
    provider: 'cursor',
    session: null,
    weekly: null,
    monthly: null,
    updatedAt: Date.now(),
    status,
    error,
    usageMetadata: {
      source: 'web',
      failureKind: kind,
      ...(auth?.status === 'ok' ? { authProvenance: auth.fingerprint } : {})
    }
  }
}

export async function fetchCursorRateLimits(
  options: { signal?: AbortSignal; previous?: ProviderRateLimits | null } = {}
): Promise<ProviderRateLimits> {
  const auth = readCursorAuth()
  if (auth.status !== 'ok') {
    return failure(
      auth.status === 'missing' ? 'unavailable' : 'error',
      auth.status === 'unreadable'
        ? 'keychain-unavailable'
        : auth.status === 'missing'
          ? 'missing-credentials'
          : 'stale-token',
      'Open Cursor or run agent login on the computer running Orca, then refresh usage.'
    )
  }
  const previous = options.previous
  if (
    previous?.usageMetadata?.authProvenance === auth.fingerprint &&
    (previous.usageMetadata.retryAtMs ?? 0) > Date.now()
  ) {
    return previous
  }
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
    : AbortSignal.timeout(10_000)
  let result: ProviderRateLimits
  try {
    const response = await net.fetch('https://cursor.com/api/usage-summary', {
      headers: { Cookie: auth.cookie, Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      signal
    })
    if (!response.ok) {
      const kind =
        response.status === 401 || response.status === 403
          ? 'stale-token'
          : response.status === 429
            ? 'rate-limited'
            : 'server'
      result = failure(
        'error',
        kind,
        `Cursor usage request failed (HTTP ${response.status}).`,
        auth
      )
      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
        if (retryAfterMs !== null) {
          result.usageMetadata = { ...result.usageMetadata, retryAtMs: Date.now() + retryAfterMs }
        }
      }
    } else {
      const summary = parseCursorUsageSummary(await response.json())
      result = summary
        ? {
            provider: 'cursor',
            session: null,
            weekly: null,
            ...summary,
            updatedAt: Date.now(),
            status: 'ok',
            error: null,
            usageMetadata: { source: 'web', authProvenance: auth.fingerprint }
          }
        : failure(
            'error',
            'usage-unavailable',
            'Cursor did not report a supported monthly allowance.',
            auth
          )
    }
  } catch (error) {
    result = failure(
      'error',
      error instanceof SyntaxError ? 'parse' : 'network',
      'Could not refresh Cursor usage.',
      auth
    )
  }
  const current = readCursorAuth()
  if (current.status !== 'ok' || current.fingerprint !== auth.fingerprint) {
    return failure('error', 'missing-credentials', 'Cursor sign-in changed. Refresh usage again.')
  }
  return result
}
