import type { AgentSessionRecordCommand } from '../../../runtime/agent-session/records/agent-session-record-command'
import { DashboardAllocationError } from '../../../dashboard-accounts/dashboard-allocation-protocol'
import {
  DashboardCodexPoolAuthenticationSchema,
  type DashboardCodexPoolAuthentication
} from '../../../dashboard-accounts/dashboard-codex-pool-authentication'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from '../host/structured-agent-session-host-types'
import { sameProviderChild } from '../host/structured-agent-session-provider-child'
import type { StructuredAgentSessionStartupAttempts } from './structured-agent-session-startup-attempt'
import type { StructuredAgentSessionProviderOpenInput } from './structured-agent-session-provider-open-contract'

export type StructuredAgentSessionPoolAuthenticationContext = {
  sessions: { get(sessionId: string): Pick<StructuredAgentSessionHostSession, 'child'> | undefined }
  runtimeState: { startupAttempts: Pick<StructuredAgentSessionStartupAttempts, 'onClock'> }
  now: () => number
}

type ProviderHandleCommand = Extract<AgentSessionRecordCommand, { kind: 'provider-handle' }>

type PoolAuthenticationEvent = Pick<
  StructuredAgentSessionProviderOpenInput,
  'sessionId' | 'fence' | 'acquisitionGeneration'
>

/** In-memory half of the proof; the record half runs inside the store transaction. */
export function assertStructuredAgentSessionPoolAuthenticationLive(
  context: StructuredAgentSessionPoolAuthenticationContext,
  event: PoolAuthenticationEvent,
  authentication: DashboardCodexPoolAuthentication,
  signal?: AbortSignal
): void {
  const child = context.sessions.get(event.sessionId)?.child
  const expectedChild = { fence: event.fence, generation: event.acquisitionGeneration }
  if (
    !DashboardCodexPoolAuthenticationSchema.safeParse(authentication).success ||
    signal?.aborted ||
    !child ||
    child.phase !== 'starting' ||
    !sameProviderChild(child, expectedChild) ||
    !context.runtimeState.startupAttempts.onClock(event.sessionId, expectedChild)
  ) {
    throw new DashboardAllocationError()
  }
}

/** Saves the handle, and with a pool receipt the authenticated identity, in one record write. */
export function recordStructuredAgentSessionStartedHandle(
  context: StructuredAgentSessionPoolAuthenticationContext & {
    deps: Pick<StructuredAgentSessionHostDeps, 'store'>
  },
  event: PoolAuthenticationEvent & { poolAuthentication?: DashboardCodexPoolAuthentication },
  args: ProviderHandleCommand['args'],
  launched: ProviderHandleCommand['launched'],
  signal?: AbortSignal
) {
  const { poolAuthentication } = event
  if (poolAuthentication === undefined) {
    return context.deps.store.updateRecord(event.sessionId, {
      kind: 'provider-handle',
      args,
      launched
    })
  }
  return context.deps.store.updateRecord(
    event.sessionId,
    {
      kind: 'provider-handle',
      args,
      launched,
      pool: { sessionId: event.sessionId, fence: event.fence, poolAuthentication }
    },
    () =>
      assertStructuredAgentSessionPoolAuthenticationLive(context, event, poolAuthentication, signal)
  )
}
