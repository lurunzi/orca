import type { AgentSessionFastModeSupport } from '../../shared/agent-session-wire'
import type { ClaudeSession } from './claude-structured-session-state'

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
