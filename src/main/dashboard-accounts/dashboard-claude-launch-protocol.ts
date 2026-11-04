import type { AgentSessionProcessIdentity } from '../../shared/agent-session/lifecycle/agent-session-record'
import type { DashboardClaudeAllocation } from './dashboard-allocation-protocol'

export type DashboardClaudeLaunchBinding = Pick<
  DashboardClaudeAllocation,
  'account_id' | 'binding_revision' | 'credential_version'
>
export type DashboardClaudeSessionLaunch = {
  binding: DashboardClaudeLaunchBinding
  process: AgentSessionProcessIdentity
  initialized: boolean
}
export type DashboardClaudeProcessLaunch = DashboardClaudeLaunchBinding & {
  session_id: string
  fence: number
  acquisition_generation: string
  process: AgentSessionProcessIdentity
  initialized: boolean
  connection_open: boolean
  closing: boolean
}
export type DashboardClaudeLaunchState = {
  pending_acquisitions: number
  processes: DashboardClaudeProcessLaunch[]
}
