import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_SESSION_RECORD_SCHEMA_VERSION,
  type AgentSessionRecord
} from '../../../shared/agent-session-record'
import type { AgentSessionHandoffStatus } from '../../../shared/agent-session-wire'
import { StructuredAgentSessionHandoffState } from './structured-agent-session-handoff-state'

const SESSION = 'session-recovered'

function liveRecord(): AgentSessionRecord {
  return {
    schemaVersion: AGENT_SESSION_RECORD_SCHEMA_VERSION,
    sessionId: SESSION,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'folder'
    },
    provider: 'codex',
    providerHandleChain: [],
    accountHome: { variable: 'CODEX_HOME', path: '/fixture/codex' },
    createdAt: 1,
    updatedAt: 1,
    lease: {
      sessionId: SESSION,
      runtimeKind: 'native',
      runtimeFence: 2,
      handoffStage: null,
      provenHandleLinkId: null,
      ownerProcess: {
        hostId: 'local',
        pid: 42,
        processStartTimeMs: 1,
        spawnToken: 'native-owner'
      },
      reservedSpawnToken: null,
      leaseDeadlineAt: 30_000,
      lastRenewedAt: 1,
      handoffOperationId: null,
      journalCheckpoint: null,
      claimKeyId: 'fixture-key',
      claimStatus: 'live',
      unreconciled: false,
      deathEvidence: null
    }
  }
}

function state(record: AgentSessionRecord) {
  const publish = vi.fn<(sessionId: string, status: AgentSessionHandoffStatus) => void>()
  return {
    handoff: new StructuredAgentSessionHandoffState({ requireRecord: () => record, publish }),
    publish
  }
}

describe('structured handoff status after owner recovery', () => {
  it.each([
    {
      owner: 'none',
      direction: null,
      phase: 'idle',
      stage: null,
      operationId: null
    },
    {
      owner: 'none',
      direction: 'to-native',
      phase: 'failed',
      stage: 'manual-recovery',
      operationId: 'old-operation',
      error: { message: 'manual recovery', recoverableOwner: 'none' }
    }
  ] satisfies AgentSessionHandoffStatus[])(
    'publishes the proven native owner over stale $phase status',
    (stale) => {
      const { handoff, publish } = state(liveRecord())
      handoff.setStatus(SESSION, stale)
      publish.mockClear()

      expect(handoff.status(SESSION)).toMatchObject({ owner: 'native', phase: 'idle', stage: null })
      expect(publish).toHaveBeenCalledExactlyOnceWith(
        SESSION,
        expect.objectContaining({ owner: 'native', phase: 'idle' })
      )
      handoff.status(SESSION)
      expect(publish).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps manual recovery while the stored owner is not yet reconciled', () => {
    const record = liveRecord()
    record.lease.unreconciled = true
    const { handoff, publish } = state(record)
    const failed: AgentSessionHandoffStatus = {
      owner: 'none',
      direction: 'to-native',
      phase: 'failed',
      stage: 'manual-recovery',
      operationId: 'old-operation',
      error: { message: 'manual recovery', recoverableOwner: 'none' }
    }
    handoff.setStatus(SESSION, failed)
    publish.mockClear()

    expect(handoff.status(SESSION)).toBe(failed)
    expect(publish).not.toHaveBeenCalled()
  })

  it('preserves a failed handoff that still identifies the native owner', () => {
    const { handoff, publish } = state(liveRecord())
    const failed: AgentSessionHandoffStatus = {
      owner: 'native',
      direction: 'to-tui',
      phase: 'failed',
      stage: null,
      operationId: 'failed-operation',
      error: { message: 'terminal did not open', recoverableOwner: 'native' }
    }
    handoff.setStatus(SESSION, failed)
    publish.mockClear()

    expect(handoff.status(SESSION)).toBe(failed)
    expect(publish).not.toHaveBeenCalled()
  })
})
