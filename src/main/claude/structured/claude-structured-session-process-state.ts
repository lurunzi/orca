import type { DashboardClaudeLaunchState } from '../../dashboard-accounts/dashboard-claude-launch-protocol'
import type { ClaudeSession, ClaudeSessionExit } from './claude-structured-session-state'
import { retainsClaudePoolRootExit } from './claude-structured-close-exit-observation'

export function readClaudeDashboardLaunches(
  sessions: ReadonlyMap<string, ClaudeSession>,
  pendingAcquisitions: number,
  exits: ReadonlyMap<string, ClaudeSessionExit>
): DashboardClaudeLaunchState {
  const processes: DashboardClaudeLaunchState['processes'] = []
  const append = (sessionId: string, session: ClaudeSession, retiring = false): void => {
    const launch = session.dashboardLaunch
    if (!launch) {
      return
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
      closing: retiring || Boolean(session.closeFinalization) || session.connection.closed
    })
  }
  for (const [sessionId, session] of sessions) {
    append(sessionId, session)
  }
  for (const [sessionId, exit] of exits) {
    if (!sessions.has(sessionId) && retainsClaudePoolRootExit(exit.session)) {
      append(sessionId, exit.session, true)
    }
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
