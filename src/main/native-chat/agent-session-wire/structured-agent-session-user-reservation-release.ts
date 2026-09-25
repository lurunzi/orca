// The user's explicit exit from an ownerless reservation latched in recovery.
//
// Freeing a reservation needs proof that nothing spawned under its token, and a host that cannot
// read another process's environment never gets that proof, so the lease latches with no way out.
// The user is then the only remaining witness: they attest that no agent process holds the
// session, and this marks the reservation processless so the ordinary eviction path frees it. It
// never signals a process, and it refuses whenever the lease records one.

import {
  isAgentSessionWireRefusalCode,
  type AgentSessionHandoffStatus,
  type AgentSessionReservationReleaseResult,
  type AgentSessionWireRefusal
} from '../../../shared/agent-session-wire'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import {
  idleStructuredHandoffStatus,
  structuredReservationIsUserReleasable
} from './structured-agent-session-handoff-status'

export type StructuredReservationReleaseDeps = {
  store: AgentSessionRecordStore
  now: () => number
  serialize: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
  resolveRecovery: (sessionId: string) => Promise<'resolved' | 'unresolved' | 'not-applicable'>
  setStatus: (sessionId: string, status: AgentSessionHandoffStatus) => void
  /** Re-acquires a provider child for a session a surface still holds. */
  resumeHeld: (sessionId: string) => Promise<void>
}

function refuse(refusal: AgentSessionWireRefusal): AgentSessionReservationReleaseResult {
  return { ok: false, refusal }
}

async function releaseLatchedReservation(
  deps: StructuredReservationReleaseDeps,
  sessionId: string,
  expectedRuntimeFence: number
): Promise<AgentSessionReservationReleaseResult> {
  const record = deps.store.getRecord(sessionId)
  if (!record) {
    return refuse({
      code: 'agent_session_operation_invalid',
      message: 'This session is not on this host.'
    })
  }
  if (record.lease.runtimeFence !== expectedRuntimeFence) {
    return refuse({
      code: 'agent_session_checkpoint_stale',
      message: 'The session changed since it was shown.',
      currentFence: record.lease.runtimeFence
    })
  }
  if (record.lease.ownerProcess !== null) {
    return refuse({
      code: 'agent_session_conflict',
      message: 'A process is recorded as owning this session, so it cannot be released.'
    })
  }
  if (!structuredReservationIsUserReleasable(record)) {
    return refuse({
      code: 'agent_session_operation_conflict',
      message: 'This session is not waiting on an unused reservation.'
    })
  }
  const now = deps.now()
  await deps.store.setReservationProcesslessProof({
    sessionId,
    fence: record.lease.runtimeFence,
    spawnToken: record.lease.reservedSpawnToken,
    now,
    processlessAt: now
  })
  const outcome = await deps.resolveRecovery(sessionId)
  const released = deps.store.getRecord(sessionId)
  if (outcome !== 'resolved' || !released) {
    // The mark is durable, so the next restart's adjudication still frees it.
    return refuse({
      code: 'agent_session_ownership_unknown',
      message: 'The reservation was marked unused but is not free yet. Restart Orca to finish.'
    })
  }
  const status = idleStructuredHandoffStatus(released)
  deps.setStatus(sessionId, status)
  return { ok: true, status }
}

export async function releaseStructuredReservationByUser(
  deps: StructuredReservationReleaseDeps,
  params: { sessionId: string; expectedRuntimeFence: number }
): Promise<AgentSessionReservationReleaseResult> {
  let result: AgentSessionReservationReleaseResult
  try {
    result = await deps.serialize(params.sessionId, () =>
      releaseLatchedReservation(deps, params.sessionId, params.expectedRuntimeFence)
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (!isAgentSessionWireRefusalCode(code)) {
      throw error
    }
    return refuse({ code, message: 'The session changed while it was being released.' })
  }
  if (result.ok) {
    // Outside the serialized step: resuming attaches, which serializes on the same session.
    await deps.resumeHeld(params.sessionId).catch((error: unknown) => {
      console.warn('[agent-session] resume after reservation release failed', error)
    })
  }
  return result
}
