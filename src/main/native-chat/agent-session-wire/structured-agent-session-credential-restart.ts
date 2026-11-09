import {
  DashboardAgentRestartCode as Code,
  DashboardAgentRestartError,
  DashboardAgentRestartRequestSchema,
  DashboardAgentRestartResultSchema,
  type DashboardAgentRestartRequest,
  type DashboardAgentRestartResult
} from '../../dashboard-accounts/dashboard-agent-restart-protocol'
import { DashboardToolProvider } from '../../dashboard-accounts/dashboard-allocation-protocol'
import type { AgentSessionProcessIdentity } from '../../../shared/agent-session/lifecycle/agent-session-record'
import type { StructuredAgentSessionAttachContext } from './acquisition/structured-agent-session-attach-context'
import { stopStructuredAgentSessionAgentUnderSerialize } from './termination/structured-agent-session-host-lifetime'
import { claimOperationStart } from './startup/structured-agent-session-agent-start'
import { sameProviderChild } from './host/structured-agent-session-provider-child'
import { holdUnsentSends } from '../agent-session-journal/queued-messages/journal-unsent-send-hold'

const nativeAgents: Readonly<Record<DashboardToolProvider, string>> = {
  [DashboardToolProvider.Codex]: 'codex',
  [DashboardToolProvider.ClaudeCode]: 'claude'
}
function matchesProcess(
  a: AgentSessionProcessIdentity | null,
  b: AgentSessionProcessIdentity
): boolean {
  return (
    a !== null &&
    a.hostId === b.hostId &&
    a.pid === b.pid &&
    a.processStartTimeMs === b.processStartTimeMs &&
    a.spawnToken === b.spawnToken
  )
}
function requireTarget(
  context: StructuredAgentSessionAttachContext,
  target: DashboardAgentRestartRequest
) {
  const session = context.sessions.get(target.session_id)
  const child = session?.child
  const record = context.deps.store.requireWritableRecord(target.session_id)
  if (
    !session ||
    !child ||
    child.phase !== 'ready' ||
    child.close ||
    context.runtimeState.startFlights.has(target.session_id)
  ) {
    throw new DashboardAgentRestartError(Code.TargetChanged)
  }
  if (
    child.fence !== target.fence ||
    child.generation !== target.acquisition_generation ||
    record.provider !== nativeAgents[target.provider] ||
    record.lease.unreconciled ||
    record.lease.claimStatus !== 'live' ||
    record.lease.runtimeFence !== target.fence ||
    !matchesProcess(record.lease.ownerProcess, target.process)
  ) {
    throw new DashboardAgentRestartError(Code.TargetChanged)
  }
  return { session, child }
}
export function restartStructuredAgentSessionForCredentials(
  context: StructuredAgentSessionAttachContext,
  input: unknown
): Promise<DashboardAgentRestartResult> {
  return context.tasks.trackAttach(restart(context, input))
}
async function restart(
  attach: StructuredAgentSessionAttachContext,
  input: unknown
): Promise<DashboardAgentRestartResult> {
  try {
    const parsed = DashboardAgentRestartRequestSchema.safeParse(input)
    if (!parsed.success) {
      throw new DashboardAgentRestartError(Code.InvalidRequest)
    }
    const target = parsed.data
    const claim = await attach.serialize(target.session_id, async () => {
      const { session, child } = requireTarget(attach, target)
      await holdUnsentSends(session.journal, { fence: target.fence, hold: { cause: 'chatClosed' } })
      await session.journal.markQueueReopen(target.fence)
      requireTarget(attach, target)
      try {
        await stopStructuredAgentSessionAgentUnderSerialize(attach, target.session_id, {
          cause: 'evict',
          reason: 'credential restart',
          requireObservedExit: true
        })
      } catch {
        throw new DashboardAgentRestartError(Code.ExitUnconfirmed)
      }
      const ended = session.lastEndedChild
      if (
        attach.sessions.get(target.session_id) !== session ||
        session.child ||
        !ended ||
        !sameProviderChild(ended, child) ||
        !ended.rootGone ||
        ended.deathEvidenceKind === 'kill-delivered'
      ) {
        throw new DashboardAgentRestartError(Code.ExitUnconfirmed)
      }
      return claimOperationStart(attach, target.session_id)
    })
    const started = await claim.outcome
    if (!started.ok) {
      throw new DashboardAgentRestartError(Code.Failed)
    }
    return await attach.serialize(target.session_id, async () => {
      const record = attach.deps.store.requireWritableRecord(target.session_id)
      const child = attach.sessions.get(target.session_id)?.child
      if (
        !child ||
        child.close ||
        child.phase !== 'ready' ||
        !child.generation ||
        child.generation === target.acquisition_generation ||
        child.fence <= target.fence ||
        record.provider !== nativeAgents[target.provider] ||
        record.lease.claimStatus !== 'live' ||
        record.lease.runtimeFence !== child.fence ||
        record.lease.unreconciled ||
        !record.lease.ownerProcess
      ) {
        throw new DashboardAgentRestartError(Code.Failed)
      }
      const process = record.lease.ownerProcess
      return DashboardAgentRestartResultSchema.parse({
        provider: target.provider,
        session_id: target.session_id,
        fence: child.fence,
        acquisition_generation: child.generation,
        previous_exit_observed: true,
        process: {
          hostId: process.hostId,
          pid: process.pid,
          processStartTimeMs: process.processStartTimeMs,
          spawnToken: process.spawnToken
        }
      })
    })
  } catch (error) {
    throw error instanceof DashboardAgentRestartError
      ? error
      : new DashboardAgentRestartError(Code.Failed)
  }
}
