import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import { agentSessionFailureFact } from '../../../../shared/agent-session/failures/agent-session-failure'
import { recordAgentSessionProviderHandle } from '../../../runtime/agent-session/ownership/agent-session-provider-handle-transition'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from '../host/structured-agent-session-host-types'
import { DashboardAllocationError } from '../../../dashboard-accounts/dashboard-allocation-protocol'
import {
  recordStructuredAgentSessionPoolAuthentication,
  type StructuredAgentSessionPoolAuthenticationContext
} from './structured-agent-session-pool-authentication'
import type { StructuredAgentSessionProviderOpenResult } from './structured-agent-session-provider-open-contract'
import type { StructuredAgentSessionProviderStartedContext } from './structured-agent-session-provider-started'
import { structuredAgentSessionConversationFence } from '../host/structured-agent-session-provider-child'
import {
  AgentSessionStartFailure,
  agentSessionStartFailure
} from './structured-agent-session-start-failure'
import {
  applyStructuredRewindRecovery,
  readStructuredRewindRecovery,
  type StructuredRewindRecoveryEvidence
} from '../rewind/structured-rewind-recovery'

// What a starting child's open answered, read and recorded before the start is ready.

export type OpenedProvider = StructuredAgentSessionProviderOpenResult & {
  sessionId: string
  fence: number
  acquisitionGeneration: string
}

/** Orca could not record or apply what the open answered; nothing about the agent says retry. */
export function refusedStart(): AgentSessionStartFailure {
  return new AgentSessionStartFailure(
    new Error('Orca could not record what the agent answered at its start'),
    'never',
    agentSessionFailureFact('hostStopped')
  )
}

/** Reconcile uncertain rewind before delivery; persistent uncertainty fails startup with the
 *  adapter's verdict on its read, or as final when Orca's own reading failed. */
export async function readRewindAtStart(
  context: StructuredAgentSessionProviderStartedContext,
  event: OpenedProvider,
  signal?: AbortSignal
): Promise<StructuredRewindRecoveryEvidence | AgentSessionStartFailure> {
  const { sessionId } = event
  const journal = context.sessions.get(sessionId)?.journal
  if (!journal) {
    return null
  }
  try {
    return await readStructuredRewindRecovery(
      context.deps,
      sessionId,
      journal,
      structuredAgentSessionConversationFence(context.deps.store, sessionId),
      context.deps.adapter,
      signal,
      recordWithStartedHandle(context, event)
    )
  } catch (error) {
    rewindRecoveryFailed(context, sessionId, error, signal)
    return agentSessionStartFailure(error)
  }
}

/** Predict the committed handle for rewind cuts; if recording is refused, retain the existing record. */
function recordWithStartedHandle(
  context: StructuredAgentSessionProviderStartedContext,
  { sessionId, fence, link }: OpenedProvider
): AgentSessionRecord | null {
  const record = context.deps.store.getRecord(sessionId)
  try {
    return record && link
      ? recordAgentSessionProviderHandle({ record, fence, link, now: context.now() })
      : record
  } catch {
    return record
  }
}

export async function applyRewindAtStart(
  context: StructuredAgentSessionProviderStartedContext,
  sessionId: string,
  session: StructuredAgentSessionHostSession,
  evidence: StructuredRewindRecoveryEvidence
): Promise<boolean> {
  try {
    await applyStructuredRewindRecovery(
      context.deps,
      sessionId,
      session.journal,
      structuredAgentSessionConversationFence(context.deps.store, sessionId),
      evidence
    )
    return true
  } catch (error) {
    rewindRecoveryFailed(context, sessionId, error)
    return false
  }
}

function rewindRecoveryFailed(
  context: StructuredAgentSessionProviderStartedContext,
  sessionId: string,
  error: unknown,
  signal?: AbortSignal
): void {
  if (!signal?.aborted) {
    context.deps.logger.warn('settling a rewind in doubt at the start failed', {
      scope: 'rewind-recovery',
      sessionId,
      error
    })
  }
}

type StartedHandleContext = StructuredAgentSessionPoolAuthenticationContext & {
  deps: Pick<StructuredAgentSessionHostDeps, 'store' | 'logger' | 'nameProviderConversation'>
}

/** Persist the opened handle before delivery so future starts can resume; false if no handle is proven. */
export async function recordStartedHandle(
  context: StartedHandleContext,
  event: OpenedProvider,
  signal?: AbortSignal
): Promise<boolean> {
  const { store, logger } = context.deps
  const { link, poolAuthentication } = event
  if (!link && poolAuthentication === undefined) {
    // Only an already-proven handle permits open without a new link.
    return store.getRecord(event.sessionId)?.lease.provenHandleLinkId != null
  }
  try {
    if (!link) {
      throw new DashboardAllocationError()
    }
    const committed = await store.transitionHandoff(event.sessionId, (record) => {
      const authenticated =
        poolAuthentication === undefined
          ? record
          : recordStructuredAgentSessionPoolAuthentication(
              context,
              event,
              record,
              poolAuthentication,
              signal
            )
      return recordAgentSessionProviderHandle({
        record: authenticated,
        fence: event.fence,
        link,
        now: context.now()
      })
    })
    // Inherit only a committed new context; a resumed CLI keeps its own later title.
    if (event.newConversation ?? (link.origin === 'created' || link.origin === 'forked')) {
      context.deps.nameProviderConversation?.(committed)
    }
    return true
  } catch (error) {
    logger.warn('recording the handle a started provider answered with failed', {
      scope: 'provider-started-handle',
      sessionId: event.sessionId,
      error: poolAuthentication === undefined ? error : new DashboardAllocationError()
    })
    return false
  }
}
