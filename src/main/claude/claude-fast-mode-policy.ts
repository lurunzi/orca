import type { AgentSessionFastModeSupport } from '../../shared/agent-session-wire'
import type { ClaudeStructuredLaunch } from './claude-structured-launch-resolution'
import type { ClaudeSession } from './structured/claude-structured-session-state'

/** The execution host's account answer for the child one launch started. */
export type ClaudeFastModeAccountReader = (
  launch: ClaudeStructuredLaunch,
  settings: unknown,
  timeoutMs: number | undefined,
  initialization: unknown
) => Promise<AgentSessionFastModeSupport>

/** A running session's account reader, bound to its launch and initialize result. */
export type ClaudeSessionFastModeAccountReader = (
  settings: unknown,
  timeoutMs?: number
) => Promise<AgentSessionFastModeSupport>

export function claudeFastModeAccountSupport(session: ClaudeSession): AgentSessionFastModeSupport {
  const account = session.fastModeAccountSupport
  if (!account || (account.supported && account.accountVerified !== true)) {
    return { supported: false, reason: 'availability-unconfirmed' }
  }
  if (!account.supported) {
    return account
  }
  const reason = session.fastModeDisabledReason
  if (reason && ['network_error', 'unknown', 'pending'].includes(reason)) {
    return { supported: false, reason: 'availability-unconfirmed' }
  }
  return reason && reason !== 'sdk_opt_in_required' ? { supported: false, reason } : account
}

export async function refreshClaudeFastModeAccountSupport(
  session: ClaudeSession,
  settings: unknown,
  timeoutMs?: number
): Promise<void> {
  if (!session.readFastModeAccountSupport) {
    return
  }
  session.fastModeAccountRead ??= session
    .readFastModeAccountSupport(settings, timeoutMs)
    .catch((): AgentSessionFastModeSupport => ({
      supported: false,
      reason: 'availability-unconfirmed'
    }))
    .then((support) => {
      session.fastModeAccountSupport = support
      if (
        support.supported &&
        support.accountVerified &&
        ['extra_usage_disabled', 'free', 'network_error', 'unknown', 'pending'].includes(
          session.fastModeDisabledReason ?? ''
        )
      ) {
        delete session.fastModeDisabledReason
      }
    })
    .finally(() => {
      delete session.fastModeAccountRead
    })
  await session.fastModeAccountRead
}
