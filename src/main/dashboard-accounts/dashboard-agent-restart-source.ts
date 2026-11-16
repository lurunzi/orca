import { DashboardToolProvider } from './dashboard-allocation-protocol'
import {
  DashboardAgentRestartCode as Code,
  DashboardAgentRestartError,
  type DashboardAgentRestartRequest
} from './dashboard-agent-restart-protocol'
import { DashboardCodexAdoptionStateSchema } from './dashboard-codex-adoption-protocol'
import { DashboardClaudeLaunchStateSchema } from './dashboard-claude-launch-protocol'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/host/structured-agent-session-host'

type PoolProcess = {
  session_id: string
  fence: number
  acquisition_generation: string
  connection_open: boolean
  closing: boolean
}
function matchingPoolProcess<T extends PoolProcess>(
  processes: readonly T[],
  target: DashboardAgentRestartRequest
): T {
  const matches = processes.filter((process) => process.session_id === target.session_id)
  const process = matches[0]
  if (
    matches.length !== 1 ||
    !process ||
    process.fence !== target.fence ||
    process.acquisition_generation !== target.acquisition_generation ||
    !process.connection_open ||
    process.closing
  ) {
    throw new DashboardAgentRestartError(Code.TargetChanged)
  }
  return process
}
type RestartSource = {
  require(host: StructuredAgentSessionHost, target: DashboardAgentRestartRequest): void
}
class CodexRestartSource implements RestartSource {
  require(host: StructuredAgentSessionHost, target: DashboardAgentRestartRequest): void {
    const report = host.deps.agents.registration('codex')?.adapter.readDashboardCodexProcesses?.()
    if (report === undefined) {
      throw new DashboardAgentRestartError(Code.Unavailable)
    }
    matchingPoolProcess(DashboardCodexAdoptionStateSchema.parse(report).processes, target)
  }
}
class ClaudeRestartSource implements RestartSource {
  require(host: StructuredAgentSessionHost, target: DashboardAgentRestartRequest): void {
    const report = host.deps.agents.registration('claude')?.adapter.readDashboardClaudeLaunches?.()
    if (report === undefined) {
      throw new DashboardAgentRestartError(Code.Unavailable)
    }
    const process = matchingPoolProcess(
      DashboardClaudeLaunchStateSchema.parse(report).processes,
      target
    )
    if (!process.initialized) {
      throw new DashboardAgentRestartError(Code.TargetChanged)
    }
  }
}
export const DASHBOARD_AGENT_RESTART_SOURCES: Readonly<
  Record<DashboardToolProvider, RestartSource>
> = {
  [DashboardToolProvider.Codex]: new CodexRestartSource(),
  [DashboardToolProvider.ClaudeCode]: new ClaudeRestartSource()
}
