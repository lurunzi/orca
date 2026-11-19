import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import { createStructuredAgentSessionOwnerProbe } from './structured-agent-session-owner-probe'

function reservedRecord(reservedSpawnToken: string): AgentSessionRecord {
  return {
    sessionId: 'session-1',
    providerHandleChain: [],
    lease: { ownerProcess: null, reservedSpawnToken, claimStatus: 'reserved', runtimeFence: 3 }
  } as unknown as AgentSessionRecord
}

describe('structured agent-session owner probe', () => {
  it('hands the reservation record to the scan so Windows can prove absence from argv', async () => {
    const scan = vi.fn(async () => [])
    const reserved = reservedRecord('token-1')
    const probe = vi.fn(async () => ({ outcome: 'pid-absent' }) as const)

    await createStructuredAgentSessionOwnerProbe('local', probe, scan)(reserved)

    expect(scan).toHaveBeenCalledWith('token-1', reserved)
  })
})
