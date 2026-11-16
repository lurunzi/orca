import type { AgentSessionProviderHandleLink } from '../../../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle'
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
  link: AgentSessionProviderHandleLink,
  signal?: AbortSignal
) {
  const { poolAuthentication } = event
  const args = { fence: event.fence, link, now: context.now() }
  if (poolAuthentication === undefined) {
    return context.deps.store.updateRecord(event.sessionId, { kind: 'provider-handle', args })
  }
  return context.deps.store.updateRecord(
    event.sessionId,
    {
      kind: 'provider-handle',
      args,
      pool: { sessionId: event.sessionId, fence: event.fence, poolAuthentication }
    },
    () =>
      assertStructuredAgentSessionPoolAuthenticationLive(context, event, poolAuthentication, signal)
  )
}
