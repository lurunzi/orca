import type { StructuredAgentSessionClientDelivery } from '../publication/subscribers/structured-agent-session-client-delivery'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from '../host/structured-agent-session-host-types'
import { readHostStructuredAgentSessionWork } from '../observations/structured-agent-session-read-work'
import { structuredAgentSessionChildOwesWork } from '../recovery/structured-agent-session-outgrown-child'

type RetainedWorkInput = {
  deps: Pick<StructuredAgentSessionHostDeps, 'store' | 'hasOpenDispatch' | 'adapter'>
  sessions: ReadonlyMap<string, StructuredAgentSessionHostSession>
  clientDelivery: Pick<StructuredAgentSessionClientDelivery, 'readChildWork' | 'childWorkOpen'>
}

/** The work that keeps a chat's agent running; sends of `continuingId` are the ones handed over. */
export function structuredAgentSessionRetainedWork({
  deps,
  sessions,
  clientDelivery
}: RetainedWorkInput) {
  const workHost = { store: deps.store, sessions }
  return (sessionId: string, continuingId?: string) => ({
    currentWork: () =>
      readHostStructuredAgentSessionWork(workHost, sessionId, { kind: 'child-work' }),
    childWork: () => clientDelivery.readChildWork(sessionId),
    childWorkOpen: () => clientDelivery.childWorkOpen(sessionId),
    hasOpenDispatch: () => {
      const record = deps.store.getConversation(sessionId)
      return record !== null && deps.hasOpenDispatch?.(record) === true
    },
    providerHoldsDispatch: () =>
      deps.adapter.holdsDispatch?.(sessionId) === true ||
      [...(sessions.get(sessionId)?.child?.heldSends?.() ?? [])].some((id) => id !== continuingId)
  })
}

/** The fence of a chat's live agent that owed work keeps: a send reaches it, not a new launch on
 *  the selected account. Unreadable work counts as owed, as retirement treats it. */
export async function structuredAgentSessionKeptAgentFence(
  input: RetainedWorkInput,
  sessionId: string
): Promise<number | undefined> {
  const child = input.sessions.get(sessionId)?.child
  if (!child || child.phase === 'starting' || child.close) {
    return undefined
  }
  const owes = await structuredAgentSessionChildOwesWork(
    structuredAgentSessionRetainedWork(input)(sessionId)
  ).catch(() => true)
  return owes && input.sessions.get(sessionId)?.child === child ? child.fence : undefined
}
