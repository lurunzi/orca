import type { DashboardCodexAdoptionState } from '../dashboard-accounts/dashboard-codex-adoption-protocol'
import type {
  CodexAcquisitionRegistry,
  CodexSession
} from './structured/session-lifecycle/codex-structured-session-state'

export function readCodexDashboardAdoptions(
  sessions: ReadonlyMap<string, CodexSession>,
  acquisitions: { readonly size: number }
): DashboardCodexAdoptionState {
  const processes: DashboardCodexAdoptionState['processes'] = []
  for (const [sessionId, session] of sessions) {
    if (session.ended || !session.dashboardAdoption) {
      continue
    }
    const { binding, process } = session.dashboardAdoption
    processes.push({
      session_id: sessionId,
      fence: session.fence,
      acquisition_generation: session.acquisitionGeneration,
      process: {
        hostId: process.hostId,
        pid: process.pid,
        processStartTimeMs: process.processStartTimeMs,
        spawnToken: process.spawnToken
      },
      ...binding,
      connection_open: !session.connection.closed,
      closing: Boolean(session.orcaClose)
    })
  }
  return { pending_acquisitions: acquisitions.size, processes }
}

export function holdsLiveCodexProviderProcess(
  sessions: ReadonlyMap<string, CodexSession>,
  acquisitions: CodexAcquisitionRegistry,
  sessionId: string,
  acquisitionGeneration: string
): boolean {
  const session = sessions.get(sessionId)
  const starting = acquisitions.get(sessionId)
  if (starting?.acquisitionGeneration === acquisitionGeneration) {
    return !starting.exitProven && starting.window.connection?.pid !== undefined
  }
  return (
    session?.acquisitionGeneration === acquisitionGeneration &&
    session.connection.pid !== undefined &&
    !session.ended &&
    session.exitObservedAt === undefined
  )
}
