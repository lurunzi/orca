import type { DashboardClaudeLaunchState } from '../../dashboard-accounts/dashboard-claude-launch-protocol'
import type { ClaudeSession } from './claude-structured-session-state'

export function readClaudeDashboardLaunches(
  sessions: ReadonlyMap<string, ClaudeSession>,
  pendingAcquisitions: number
): DashboardClaudeLaunchState {
  const processes: DashboardClaudeLaunchState['processes'] = []
  for (const [sessionId, session] of sessions) {
    const launch = session.dashboardLaunch
    if (!launch) {
      continue
    }
    const { binding, process } = launch
    processes.push({
      session_id: sessionId,
      fence: session.fence,
      acquisition_generation: session.acquisitionGeneration,
      account_id: binding.account_id,
      binding_revision: binding.binding_revision,
      credential_version: binding.credential_version,
      process: {
        hostId: process.hostId,
        pid: process.pid,
        processStartTimeMs: process.processStartTimeMs,
        spawnToken: process.spawnToken
      },
      initialized: launch.initialized,
      connection_open: !session.connection.closed,
      closing: Boolean(session.closeFinalization) || session.connection.closed
    })
  }
  return { pending_acquisitions: pendingAcquisitions, processes }
}

export function holdsLiveClaudeProviderProcess(
  sessions: ReadonlyMap<string, ClaudeSession>,
  sessionId: string,
  acquisitionGeneration: string
): boolean {
  const session = sessions.get(sessionId)
  return (
    session?.acquisitionGeneration === acquisitionGeneration &&
    session.connection.pid !== undefined &&
    session.connection.exitVerdict.root === 'live'
  )
}
