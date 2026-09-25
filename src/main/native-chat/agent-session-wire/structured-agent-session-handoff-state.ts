import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionHandoffStatus } from '../../../shared/agent-session-wire'
import { idleStructuredHandoffStatus } from './structured-agent-session-handoff-status'
import type { StructuredTuiOwner } from './structured-agent-session-handoff-types'

export class StructuredAgentSessionHandoffState {
  private readonly statuses = new Map<string, AgentSessionHandoffStatus>()
  private readonly tuiOwners = new Map<string, StructuredTuiOwner>()

  constructor(
    private readonly deps: {
      requireRecord: (sessionId: string) => AgentSessionRecord
      publish: (sessionId: string, status: AgentSessionHandoffStatus) => void
      hostLabel?: string
    }
  ) {}

  status = (sessionId: string): AgentSessionHandoffStatus => {
    const value = this.statuses.get(sessionId)
    const record = this.deps.requireRecord(sessionId)
    if (
      value &&
      record.lease.claimStatus === 'live' &&
      record.lease.ownerProcess &&
      !record.lease.unreconciled &&
      record.lease.handoffStage === null &&
      ((value.phase === 'idle' && value.owner !== record.lease.runtimeKind) ||
        (value.phase === 'failed' && value.error?.recoverableOwner === 'none'))
    ) {
      const status = idleStructuredHandoffStatus(record)
      this.setStatus(sessionId, status)
      return status
    }
    return value ?? idleStructuredHandoffStatus(record)
  }

  cachedStatus = (sessionId: string): AgentSessionHandoffStatus | undefined =>
    this.statuses.get(sessionId)

  owner = (sessionId: string): StructuredTuiOwner | undefined => this.tuiOwners.get(sessionId)

  retainOwner = (sessionId: string, owner: StructuredTuiOwner): void => {
    this.tuiOwners.set(sessionId, owner)
  }

  releaseOwner = (sessionId: string): void => void this.tuiOwners.delete(sessionId)

  setStatus = (sessionId: string, status: AgentSessionHandoffStatus): void => {
    this.statuses.set(sessionId, status)
    this.deps.publish(sessionId, status)
  }
}
