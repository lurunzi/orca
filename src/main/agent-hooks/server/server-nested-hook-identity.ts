import type { resolveAgentStatusIdentity } from '../../../shared/agent-status-identity'
import type { ParsedAgentStatusPayload } from '../../../shared/agent-status-types'
import type { EnrichedAgentHookEventPayload } from './server-types'

/** Fork: a nested hook takes the resolved agent type, and one inherited from the active pane keeps
 *  that pane's transcript and model, so a child's agent type never pairs with the parent's. */
export function nestedHookIdentityPayload<
  T extends {
    payload: ParsedAgentStatusPayload
    providerSession?: EnrichedAgentHookEventPayload['providerSession']
  }
>(
  row: T,
  identity: Pick<
    ReturnType<typeof resolveAgentStatusIdentity>,
    'agentType' | 'inheritedFromActivePane'
  >,
  previous: EnrichedAgentHookEventPayload | undefined
): T {
  const inherited = identity.inheritedFromActivePane
  return {
    ...row,
    ...(inherited ? { providerSession: previous?.providerSession } : {}),
    payload: {
      ...row.payload,
      agentType: identity.agentType,
      ...(inherited ? { model: previous?.payload.model } : {})
    }
  }
}
