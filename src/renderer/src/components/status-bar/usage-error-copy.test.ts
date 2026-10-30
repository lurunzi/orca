import { describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'

const i18nState = vi.hoisted(() => ({ language: 'en' }))

vi.mock('@/i18n/i18n', () => ({
  translate: (key: string, fallback: string, values?: Record<string, string>) => {
    let result =
      i18nState.language === 'ja' && key.endsWith('remoteOwnerNotConfigured')
        ? '{{server}} では未構成'
        : fallback
    for (const [name, value] of Object.entries(values ?? {})) {
      result = result.replace(`{{${name}}}`, value)
    }
    return result
  }
}))

import {
  getProviderUsageErrorMessage,
  getProviderUsageStatusLabel,
  isClaudeUsageWaitingForClaude
} from './usage-error-copy'

describe('structured failure kinds over message wording', () => {
  // Captured from codex-cli 0.162.0 `app-server` behind an unreachable proxy.
  const codexNetworkFailure = {
    provider: 'codex',
    session: null,
    weekly: null,
    updatedAt: 0,
    error:
      'failed to fetch codex rate limits: error sending request for url (https://chatgpt.com/backend-api/wham/usage)',
    status: 'error',
    usageMetadata: { failureKind: 'network' }
  } as const

  it('labels a network failure that names rate limits as a network issue, not Limited', () => {
    expect(getProviderUsageStatusLabel(codexNetworkFailure)).toBe('Network issue')
    expect(getProviderUsageErrorMessage(codexNetworkFailure)).toBe(codexNetworkFailure.error)
  })

  it('labels real rate limiting as Limited, with or without a kind', () => {
    expect(
      getProviderUsageStatusLabel({
        ...codexNetworkFailure,
        error: 'failed to fetch codex rate limits: unexpected status 429 Too Many Requests',
        usageMetadata: undefined
      })
    ).toBe('Limited')
    expect(
      getProviderUsageStatusLabel({
        ...codexNetworkFailure,
        provider: 'antigravity',
        error:
          'Antigravity usage is not available right now. The Antigravity API is rate-limiting this account.',
        usageMetadata: { failureKind: 'rate-limited' }
      })
    ).toBe('Limited')
  })
})

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

describe('provider usage error copy', () => {
  it('frames Claude auth-shaped usage failures as usage refresh failures', () => {
    const p = provider({ error: 'Invalid authentication credentials' })

    expect(getProviderUsageStatusLabel(p)).toBe('Refresh failed')
    expect(getProviderUsageErrorMessage(p)).toBe(
      'Claude usage could not be refreshed. Agent sessions may still be signed in.'
    )
  })

  it('frames provider credential and session failures without showing raw auth details', () => {
    const codex = provider({
      provider: 'codex',
      error:
        'Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.'
    })
    const gemini = provider({
      provider: 'gemini',
      error: 'Gemini CLI credentials not found'
    })

    expect(getProviderUsageStatusLabel(codex)).toBe('Refresh failed')
    expect(getProviderUsageErrorMessage(codex)).toBe(
      'Codex usage could not be refreshed. Agent sessions may still be signed in.'
    )
    expect(getProviderUsageErrorMessage(gemini)).toBe(
      'Gemini usage could not be refreshed. Agent sessions may still be signed in.'
    )
  })

  it('frames credential-file and login failures as auth-shaped usage failures', () => {
    const kimi = provider({
      provider: 'kimi',
      error: 'Kimi credentials-file is invalid'
    })
    const opencodeGo = provider({
      provider: 'opencode-go',
      error: 'Please log in before refreshing usage.'
    })

    expect(getProviderUsageErrorMessage(kimi)).toBe(
      'Kimi usage could not be refreshed. Agent sessions may still be signed in.'
    )
    expect(getProviderUsageErrorMessage(opencodeGo)).toBe(
      'OpenCode Go usage could not be refreshed. Agent sessions may still be signed in.'
    )
  })

  it('shows the exact Grok CLI recovery flow for an expired refreshable session (#8497)', () => {
    const grok = provider({
      provider: 'grok',
      error:
        'Grok sign-in expired — run grok on the computer running Orca; sign in if prompted. No chat message is needed.',
      usageMetadata: {
        failureKind: 'delegated-refresh-required',
        source: 'oauth'
      }
    })

    expect(getProviderUsageStatusLabel(grok)).toBe('Run Grok to refresh')
    expect(getProviderUsageErrorMessage(grok)).toBe(
      'Run grok in a terminal on the computer running Orca and wait for it to start. If prompted, complete sign-in, then retry usage. You do not need to send a chat message.'
    )
  })

  it('shows the exact Kimi CLI recovery flow for an expired read-only session', () => {
    const kimi = provider({
      provider: 'kimi',
      error: 'Kimi session expired — run kimi on the computer running Orca, then retry usage.',
      usageMetadata: {
        failureKind: 'delegated-refresh-required',
        source: 'oauth'
      }
    })

    expect(getProviderUsageStatusLabel(kimi)).toBe('Run Kimi to refresh')
    expect(getProviderUsageErrorMessage(kimi)).toBe(
      'Run kimi in a terminal on the computer running Orca and wait for it to start, then retry usage.'
    )
  })

  it('frames known Codex auth refresh failures as auth-shaped usage failures', () => {
    const cases = [
      'Please reauthenticate before checking usage.',
      'Not logged in.',
      'Token data is not available.',
      'Auth is missing.',
      'Auth tokens are missing.',
      'Auth does not expose access tokens.'
    ]

    for (const error of cases) {
      expect(getProviderUsageErrorMessage(provider({ provider: 'codex', error }))).toBe(
        'Codex usage could not be refreshed. Agent sessions may still be signed in.'
      )
    }
  })

  it('keeps rate-limit failures distinct from refresh failures', () => {
    const p = provider({ error: 'Claude usage is rate limited right now.' })

    expect(getProviderUsageStatusLabel(p)).toBe('Limited')
    expect(getProviderUsageErrorMessage(p)).toBe('Claude usage is rate limited right now.')
  })

  it('lets rate-limit copy win when the detail also mentions auth', () => {
    const p = provider({
      error: 'Rate limit reached while refreshing OAuth access token.'
    })

    expect(getProviderUsageStatusLabel(p)).toBe('Limited')
    expect(getProviderUsageErrorMessage(p)).toBe(
      'Rate limit reached while refreshing OAuth access token.'
    )
  })

  it('classifies the Codex chatgpt-auth-required rate-limits read error as auth, not Limited', () => {
    // Why: the message mentions "rate limits" only as the object it failed to
    // read; labeling it "Limited" would wrongly imply the user hit a limit.
    const p = provider({
      provider: 'codex',
      error: 'chatgpt authentication required to read rate limits'
    })

    expect(getProviderUsageStatusLabel(p)).toBe('Refresh failed')
    expect(getProviderUsageErrorMessage(p)).toBe(
      'Codex usage could not be refreshed. Agent sessions may still be signed in.'
    )
  })

  it('keeps generic OAuth and network failures as raw refresh details', () => {
    const oauth = provider({ error: 'OAuth API returned 500' })
    const network = provider({ error: 'Network error while refreshing OAuth usage: ECONNRESET' })

    expect(getProviderUsageStatusLabel(oauth)).toBe('Refresh failed')
    expect(getProviderUsageErrorMessage(oauth)).toBe('OAuth API returned 500')
    expect(getProviderUsageErrorMessage(network)).toBe(
      'Network error while refreshing OAuth usage: ECONNRESET'
    )
  })

  it('keeps live-Claude refresh deferral copy visible', () => {
    const p = provider({
      error:
        'Claude usage refresh is waiting for the live Claude terminal to rotate its credentials.',
      usageMetadata: {
        failureKind: 'deferred-by-live-session'
      }
    })

    expect(getProviderUsageStatusLabel(p)).toBe('Waiting for Claude session')
    expect(getProviderUsageErrorMessage(p)).toBe(
      'Claude usage will refresh after the live Claude terminal rotates its credentials.'
    )
  })

  // Why: an expired access token is not a signed-out login; Claude refreshes it the next time it runs.
  it.each([undefined, 'system', 'wsl:Ubuntu:system', 'profile:idle'])(
    'tells every Claude login (%s) calmly that usage updates when Claude next runs',
    (authProvenance) => {
      const p = provider({
        error: 'Invalid OAuth token.',
        usageMetadata: {
          failureKind: 'stale-token',
          attemptedSources: ['oauth'],
          authProvenance
        }
      })

      expect(getProviderUsageStatusLabel(p)).toBe('Updates when Claude runs')
      expect(getProviderUsageErrorMessage(p)).toBe(
        'Claude usage updates the next time Claude runs.'
      )
      expect(isClaudeUsageWaitingForClaude(p)).toBe(true)
    }
  )

  it('keeps refresh copy for failure kinds only a refreshing older host reports', () => {
    const p = provider({
      error: 'Claude OAuth access token unavailable',
      usageMetadata: { failureKind: 'refreshable-credentials-without-token' }
    })

    expect(getProviderUsageStatusLabel(p)).toBe('Refreshing sign-in')
    expect(getProviderUsageErrorMessage(p)).toBe(
      'Claude usage credentials were rejected. After signing in again, Orca will retry when the credentials file changes.'
    )
  })

  it('tells the user a selected Claude account needs signing in again', () => {
    const p = provider({
      error: 'Sign in again to use this account.',
      usageMetadata: { failureKind: 'missing-credentials' }
    })

    expect(getProviderUsageStatusLabel(p)).toBe('Sign in again')
    expect(getProviderUsageErrorMessage(p)).toBe(
      'The selected Claude account needs you to sign in again. Open Settings > AI Provider Accounts, or choose System default.'
    )
  })

  it('uses structured network copy for Claude usage failures', () => {
    const p = provider({
      error: 'Network error while refreshing OAuth usage: ECONNRESET',
      usageMetadata: { failureKind: 'network' }
    })

    expect(getProviderUsageStatusLabel(p)).toBe('Network issue')
    expect(getProviderUsageErrorMessage(p)).toBe(
      'Claude usage could not be refreshed because the network request failed.'
    )
  })

  it('uses structured Keychain copy for Claude usage failures', () => {
    const p = provider({
      error: 'Claude Keychain credentials unavailable',
      usageMetadata: { failureKind: 'keychain-unavailable' }
    })

    expect(getProviderUsageStatusLabel(p)).toBe('Sign-in unavailable')
    expect(getProviderUsageErrorMessage(p)).toBe('Claude sign-in credentials could not be read.')
  })

  it('uses structured unavailable copy for Claude CLI usage shell failures', () => {
    const p = provider({
      error: 'Claude plan usage is unavailable for this Claude CLI session.',
      usageMetadata: { failureKind: 'usage-unavailable' }
    })

    expect(getProviderUsageStatusLabel(p)).toBe('Usage unavailable')
    expect(getProviderUsageErrorMessage(p)).toBe('Claude usage is unavailable right now.')
  })
})

describe('owner placeholder tooltip', () => {
  it('follows the current language, not the one the placeholder was built in', () => {
    const placeholder = {
      provider: 'codex',
      session: null,
      weekly: null,
      updatedAt: 0,
      error: 'Not configured on devbox',
      status: 'error',
      usageMetadata: {
        ownerNotSetUp: { kind: 'not-configured', ownerLabel: 'devbox', signInSavedHereOnly: false }
      }
    } as const
    i18nState.language = 'ja'
    try {
      expect(getProviderUsageErrorMessage(placeholder)).toBe('devbox では未構成')
    } finally {
      i18nState.language = 'en'
    }
    expect(getProviderUsageErrorMessage(placeholder)).toBe('Not configured on devbox')
  })
})
