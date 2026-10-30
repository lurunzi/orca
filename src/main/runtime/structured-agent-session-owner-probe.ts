import type { AgentSessionOwnerProbe } from '../../shared/agent-session-lease-adjudication'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import {
  probeAgentSessionProcessIdentities,
  probeAgentSessionProcessIdentity,
  probeAgentSessionReservation
} from './agent-session/ownership/agent-session-process-identity-probe'
import { findAgentSessionReservationProcesses } from './agent-session/ownership/agent-session-reservation-command-line-scan'
import { readEchoedAgentSessionSpawnToken } from './agent-session/ownership/agent-session-spawn-token-readback'

/** Probe previous owners with PID-reuse-safe evidence; unresolved ownership remains indeterminate. */
export function createStructuredAgentSessionOwnerProbe(
  hostId: string,
  probe = probeAgentSessionProcessIdentity,
  findSpawnTokenProcesses: (
    spawnToken: string,
    record: AgentSessionRecord
  ) => Promise<number[] | null> = findAgentSessionReservationProcesses
): (record: AgentSessionRecord) => Promise<AgentSessionOwnerProbe> {
  return async (record) => {
    const owner = record.lease.ownerProcess
    if (!owner) {
      const spawnToken = record.lease.reservedSpawnToken
      if (spawnToken === null) {
        if (record.lease.claimStatus === 'reserved') {
          return {
            outcome: 'indeterminate',
            reason: 'reservation recorded no spawn token to scan for'
          }
        }
        // No owner or minted token means no child could hold this lease; indeterminate would trap a free record in recovery.
        return { outcome: 'reservation-unused' }
      }
      // Release requires positive evidence of no spawn; null when neither child environments nor
      // (on Windows) command lines are readable.
      return probeAgentSessionReservation({
        spawnToken,
        findProcessesWithSpawnToken: (token) => findSpawnTokenProcesses(token, record),
        hasProviderActivitySinceReservation: async () =>
          agentSessionReservationTouchedProvider(record)
      })
    }
    if (owner.hostId !== hostId) {
      // A remote pid has no meaning in this machine's process table.
      return {
        outcome: 'indeterminate',
        reason: `owner runs on ${owner.hostId}, which this host cannot probe`
      }
    }
    // Environment read-back can prove identity without start time; unsupported hosts return null.
    return probe({
      identity: owner,
      deps: { readEchoedSpawnToken: readEchoedAgentSessionSpawnToken }
    })
  }
}

export function createStructuredAgentSessionOwnerProbes(
  hostId: string,
  probeMany: typeof probeAgentSessionProcessIdentities = probeAgentSessionProcessIdentities,
  probeOne = createStructuredAgentSessionOwnerProbe(hostId)
): (records: readonly AgentSessionRecord[]) => Promise<Map<string, AgentSessionOwnerProbe>> {
  return async (records) => {
    const results = new Map<string, AgentSessionOwnerProbe>()
    const localOwners: {
      record: AgentSessionRecord
      owner: NonNullable<AgentSessionRecord['lease']['ownerProcess']>
    }[] = []
    for (const record of records) {
      const owner = record.lease.ownerProcess
      if (owner?.hostId === hostId) {
        localOwners.push({ record, owner })
      } else {
        results.set(record.sessionId, await probeOne(record))
      }
    }
    const probes = await probeMany({
      identities: localOwners.map(({ owner }) => owner),
      deps: { readEchoedSpawnToken: readEchoedAgentSessionSpawnToken }
    })
    for (const [index, { record }] of localOwners.entries()) {
      results.set(
        record.sessionId,
        probes[index] ?? { outcome: 'indeterminate', reason: 'owner probe returned no result' }
      )
    }
    return results
  }
}

/** A handle link at this fence proves provider contact only after owner identity commit; pair it with the token scan to cover unrecorded activity. */
function agentSessionReservationTouchedProvider(record: AgentSessionRecord): boolean {
  return record.providerHandleChain.at(-1)?.mintedAtFence === record.lease.runtimeFence
}
