import type { StructuredAgentSessionAcquireInput } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import { dashboardCodexChildLaunch } from '../dashboard-accounts/dashboard-codex-authentication'
import type {
  CodexAcquisitionAttempt,
  CodexAcquisitionRegistry,
  CodexSession,
  CodexStructuredLaunch
} from './codex-structured-session-state'

export function codexStructuredChildLaunch(
  launch: CodexStructuredLaunch,
  poolAuthentication: boolean
): ProviderProcessLaunch {
  const childLaunch = {
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    ...(launch.env ? { env: launch.env } : {}),
    ...(launch.envToDelete ? { envToDelete: launch.envToDelete } : {})
  }
  return poolAuthentication ? dashboardCodexChildLaunch(childLaunch) : childLaunch
}

export function codexDashboardAuthenticationCurrent(input: {
  sessions: ReadonlyMap<string, CodexSession>
  acquisitions: CodexAcquisitionRegistry
  attempt: CodexAcquisitionAttempt
  acquireInput: StructuredAgentSessionAcquireInput
}): () => boolean {
  const { sessions, acquisitions, attempt, acquireInput } = input
  const sessionId = acquireInput.identity.sessionId
  const fence = acquireInput.fence
  const window = attempt.window
  return () => {
    const connection = window.connection
    if (!connection || connection.closed || attempt.cancelled || attempt.exitProven) {
      return false
    }
    if (acquisitions.get(sessionId) === attempt) {
      return true
    }
    const session = sessions.get(sessionId)
    return (
      session?.connection === connection &&
      session.fence === fence &&
      session.acquisitionGeneration === attempt.acquisitionGeneration &&
      !session.ended &&
      !session.orcaClose
    )
  }
}
