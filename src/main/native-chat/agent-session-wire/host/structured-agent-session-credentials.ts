import { createStructuredAgentSessionConversationLifetime } from '../termination/structured-agent-session-conversation-lifetime'
import type { StructuredAgentSessionConversationLifetimeHost } from '../termination/structured-agent-session-conversation-lifetime-host'
import { restartStructuredAgentSessionAgent } from '../termination/structured-agent-session-restart-agent'

import { restartStructuredAgentSessionForCredentials } from '../structured-agent-session-credential-restart'
import type { StructuredAgentSessionHostCore } from './structured-agent-session-host-collaborators'
import type { StructuredAgentSessionAttachContext } from '../acquisition/structured-agent-session-attach-context'

/** Agent restarts and account homes: the host surface that decides which credentials a child runs with. */
export function createStructuredAgentSessionCredentials(
  core: () => StructuredAgentSessionHostCore,
  attachContext: () => StructuredAgentSessionAttachContext
) {
  return {
    restartAgentForCredentials: (input: unknown) =>
      restartStructuredAgentSessionForCredentials(attachContext(), input),
    ...createStructuredAgentSessionAccountHomes(core)
  }
}

export function createStructuredAgentSessionAccountHomes(
  core: () => Pick<StructuredAgentSessionHostCore, 'deps' | 'serialize'> & {
    sessions: Pick<StructuredAgentSessionHostCore['sessions'], 'get'>
  }
) {
  return {
    /** The home a running child launched under. ACP adapters report none, so `orPinned` falls
     *  back to the record's pinned home while a child runs. */
    childAccountHome: (id: string, orPinned = false) => {
      const { sessions, deps } = core()
      const child = sessions.get(id)?.child
      return child && orPinned
        ? (child.accountHome ?? deps.store.getConversation(id)?.accountHome)
        : child?.accountHome
    },
    prospectiveAccountHome: (id: string) => {
      const { deps, serialize } = core()
      return serialize(
        id,
        async () => (await deps.launchAccountHome?.(deps.store.requireWritableRecord(id))) ?? null
      )
    }
  }
}

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
