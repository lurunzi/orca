// Fork: Claude Fast is offered only after a running session verified the account, so a chat at
// rest neither advertises it nor saves an enable it cannot prove.

import type { AgentSessionFastModeSupport } from '../../../shared/agent-session/agent-session-wire'
import {
  refuse,
  type AgentSessionWireRefusal
} from '../../../shared/agent-session/failures/agent-session-wire-refusals'

export function restingClaudeFastRestriction(
  provider: string
): AgentSessionFastModeSupport | undefined {
  return provider === 'claude'
    ? { supported: false, reason: 'availability-unconfirmed' }
    : undefined
}

export function restingClaudeFastRefusal(
  provider: string,
  input: { key: string; value: string }
): { ok: false; refusal: AgentSessionWireRefusal } | null {
  return provider === 'claude' && input.key === 'fastMode' && input.value !== 'false'
    ? {
        ok: false,
        refusal: refuse(
          'agent_session_operation_invalid',
          { reason: 'optionRejected' },
          'Claude Fast mode availability must be confirmed by a running session before enabling it.'
        )
      }
    : null
}
