// Fork: Claude Fast is offered only after a running session verified the account, so a chat at
// rest neither advertises it nor saves an enable it cannot prove.

import {
  refuse,
  type AgentSessionModelCatalogResult,
  type AgentSessionOptionsResult
} from '../../../shared/agent-session-wire'
import type { AgentSessionWireRefusal } from '../../../shared/agent-session-wire-refusals'

export function restingFastModeSupport(
  provider: string,
  catalog: AgentSessionModelCatalogResult
): Pick<AgentSessionOptionsResult, 'fastModeSupport'> {
  if (provider === 'claude') {
    return { fastModeSupport: { supported: false, reason: 'availability-unconfirmed' } }
  }
  return catalog.origin !== 'unknown' && catalog.fastModeSupport
    ? { fastModeSupport: catalog.fastModeSupport }
    : {}
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

/** Only a live answer carries Claude's account verification; a catalog-derived view never does. */
export function withLiveVerifiedFastMode(
  view: Pick<AgentSessionOptionsResult, 'fastModeSupport'>,
  live: Pick<AgentSessionOptionsResult, 'fastModeSupport'> | null
): Pick<AgentSessionOptionsResult, 'fastModeSupport'> {
  const verified = live?.fastModeSupport
  return verified?.supported === true &&
    verified.accountVerified === true &&
    view.fastModeSupport?.reason !== 'model-not-supported'
    ? { fastModeSupport: verified }
    : view
}
