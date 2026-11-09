import { DashboardToolProvider } from '../../../../shared/dashboard-account-provider'
import { AgentSessionPoolAccountOrigin } from '../../../../shared/agent-session/lifecycle/agent-session-pool-account'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import { DashboardAllocationError } from '../../../dashboard-accounts/dashboard-allocation-protocol'
import {
  DashboardCodexPoolAuthenticationSchema,
  canUseCodexPoolIdentity,
  type DashboardCodexPoolAuthentication
} from '../../../dashboard-accounts/dashboard-codex-pool-authentication'
import type { StructuredAgentSessionHostSession } from '../host/structured-agent-session-host-types'
import { sameProviderChild } from '../host/structured-agent-session-provider-child'
import type { StructuredAgentSessionStartupAttempts } from './structured-agent-session-startup-attempt'
import type { StructuredAgentSessionProviderOpenInput } from './structured-agent-session-provider-open-contract'

export type StructuredAgentSessionPoolAuthenticationContext = {
  sessions: { get(sessionId: string): Pick<StructuredAgentSessionHostSession, 'child'> | undefined }
  runtimeState: { startupAttempts: Pick<StructuredAgentSessionStartupAttempts, 'onClock'> }
  now: () => number
}

export function recordStructuredAgentSessionPoolAuthentication(
  context: StructuredAgentSessionPoolAuthenticationContext,
  event: Pick<
    StructuredAgentSessionProviderOpenInput,
    'sessionId' | 'fence' | 'acquisitionGeneration'
  >,
  record: AgentSessionRecord,
  authentication: DashboardCodexPoolAuthentication,
  signal?: AbortSignal
): AgentSessionRecord {
  const parsed = DashboardCodexPoolAuthenticationSchema.safeParse(authentication)
  const child = context.sessions.get(event.sessionId)?.child
  const owner = record.lease.ownerProcess
  const expectedChild = { fence: event.fence, generation: event.acquisitionGeneration }
  if (
    !parsed.success ||
    signal?.aborted ||
    !child ||
    child.phase !== 'starting' ||
    !sameProviderChild(child, expectedChild) ||
    !context.runtimeState.startupAttempts.onClock(event.sessionId, expectedChild) ||
    record.sessionId !== event.sessionId ||
    record.provider !== DashboardToolProvider.Codex ||
    record.lease.sessionId !== event.sessionId ||
    record.lease.claimStatus !== 'live' ||
    record.lease.runtimeFence !== event.fence ||
    !owner
  ) {
    throw new DashboardAllocationError()
  }
  const { identity, process } = parsed.data
  if (
    owner.hostId !== process.hostId ||
    owner.pid !== process.pid ||
    owner.processStartTimeMs !== process.processStartTimeMs ||
    owner.spawnToken !== process.spawnToken
  ) {
    throw new DashboardAllocationError()
  }
  const previous = record.poolAccount
  if (previous && !canUseCodexPoolIdentity(previous, identity)) {
    throw new DashboardAllocationError()
  }
  return {
    ...record,
    poolAccount: { version: 1, origin: AgentSessionPoolAccountOrigin.Authenticated, ...identity }
  }
}
