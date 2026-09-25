// The host's recovery-facing handoff calls: a status read that first re-asks a latched TUI owner,
// the same re-ask after a lease renewal, and the user's release of an ownerless reservation.

import type {
  AgentSessionHandoffStatus,
  AgentSessionReservationReleaseResult
} from '../../../shared/agent-session-wire'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { StructuredAgentSessionHandoffCoordinator } from './structured-agent-session-handoff'
import { canRestoreLiveTuiOwner } from './structured-agent-session-handoff-restart'
import { releaseStructuredReservationByUser } from './structured-agent-session-user-reservation-release'

export type StructuredAgentSessionHostHandoffRecoverySurface = {
  /** Status after re-asking a latched TUI owner; serialized with the handoff steps. */
  refreshedStatus: (sessionId: string) => Promise<AgentSessionHandoffStatus>
  restoreRenewed: (sessionId: string) => Promise<void>
  releaseReservation: (
    sessionId: string,
    expectedRuntimeFence: number
  ) => Promise<AgentSessionReservationReleaseResult>
}

type RecoverySurfaceAccess = {
  /** Throws when the session is not attached. */
  session: (sessionId: string) => unknown
  findSession: (sessionId: string) => unknown
  serialize: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
  now: () => number
  resolveRecovery?: (sessionId: string) => Promise<'resolved' | 'unresolved' | 'not-applicable'>
  resumeHeld?: (sessionId: string) => Promise<void>
}

export async function refreshRecoverableStructuredHandoffStatus(
  handoff: Pick<StructuredAgentSessionHandoffCoordinator, 'restore' | 'status'>,
  store: AgentSessionRecordStore,
  sessionId: string
): Promise<AgentSessionHandoffStatus> {
  const record = store.getRecord(sessionId)
  if (record && canRestoreLiveTuiOwner(record)) {
    await handoff.restore(sessionId)
  }
  return handoff.status(sessionId)
}

export function createStructuredAgentSessionHostHandoffRecoverySurface(
  coordinator: StructuredAgentSessionHandoffCoordinator,
  store: AgentSessionRecordStore,
  host: RecoverySurfaceAccess
): StructuredAgentSessionHostHandoffRecoverySurface {
  return {
    refreshedStatus: async (sessionId) => {
      host.session(sessionId)
      return host.serialize(sessionId, () =>
        refreshRecoverableStructuredHandoffStatus(coordinator, store, sessionId)
      )
    },
    restoreRenewed: (sessionId) =>
      host.serialize(sessionId, async () => {
        if (host.findSession(sessionId)) {
          await refreshRecoverableStructuredHandoffStatus(coordinator, store, sessionId)
        }
      }),
    releaseReservation: (sessionId, expectedRuntimeFence) =>
      releaseStructuredReservationByUser(
        {
          store,
          now: host.now,
          serialize: host.serialize,
          resolveRecovery: host.resolveRecovery ?? (async () => 'not-applicable' as const),
          resumeHeld: host.resumeHeld ?? (async () => undefined),
          setStatus: coordinator.setStatus
        },
        { sessionId, expectedRuntimeFence }
      )
  }
}
