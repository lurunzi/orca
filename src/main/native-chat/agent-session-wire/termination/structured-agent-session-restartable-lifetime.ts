import { createStructuredAgentSessionConversationLifetime } from './structured-agent-session-conversation-lifetime'
import type { StructuredAgentSessionConversationLifetimeHost } from './structured-agent-session-conversation-lifetime-host'
import { restartStructuredAgentSessionAgent } from './structured-agent-session-restart-agent'

/** Fork: the upstream conversation lifetime plus the person's Restart Agent. */
export function createRestartableStructuredAgentSessionConversationLifetime(
  host: StructuredAgentSessionConversationLifetimeHost
) {
  const deps = () => host.context().deps
  const restartHost = {
    ...host,
    hasOpenDispatch: (sessionId: string): boolean => {
      const record = deps().store.getConversation(sessionId)
      return record !== null && deps().hasOpenDispatch?.(record) === true
    },
    providerHoldsDispatch: (sessionId: string): boolean =>
      deps().adapter.holdsDispatch?.(sessionId) === true
  }
  return {
    ...createStructuredAgentSessionConversationLifetime(host),
    restartAgent: (sessionId: string, force: boolean) =>
      restartStructuredAgentSessionAgent(restartHost, sessionId, force)
  }
}
