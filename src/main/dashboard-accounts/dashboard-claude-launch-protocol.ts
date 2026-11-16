import { z } from 'zod'
import type { AgentSessionProcessIdentity } from '../../shared/agent-session/lifecycle/agent-session-record'
import type { DashboardClaudeAllocation } from './dashboard-allocation-protocol'
import { DashboardCodexProcessSchema } from './dashboard-codex-adoption-protocol'

export type DashboardClaudeLaunchBinding = Pick<
  DashboardClaudeAllocation,
  'account_id' | 'binding_revision' | 'credential_version'
>
export type DashboardClaudeSessionLaunch = {
  binding: DashboardClaudeLaunchBinding
  process: AgentSessionProcessIdentity
  initialized: boolean
}
export const DashboardClaudeProcessLaunchSchema = DashboardCodexProcessSchema.extend({
  initialized: z.boolean()
})
export type DashboardClaudeProcessLaunch = z.infer<typeof DashboardClaudeProcessLaunchSchema>
export const DashboardClaudeLaunchStateSchema = z.strictObject({
  pending_acquisitions: z.number().int().min(0),
  processes: z.array(DashboardClaudeProcessLaunchSchema)
})
export type DashboardClaudeLaunchState = z.infer<typeof DashboardClaudeLaunchStateSchema>
const id = z.string().min(1).max(128)
const common = { schema_version: z.literal(1), instance_id: id, runtime_id: id }
export const DashboardClaudeLaunchesResponseSchema = z.union([
  z.strictObject({ ...common, supported: z.literal(false) }),
  z.strictObject({
    ...common,
    supported: z.literal(true),
    ...DashboardClaudeLaunchStateSchema.shape
  })
])
export type DashboardClaudeLaunchesResponse = z.infer<typeof DashboardClaudeLaunchesResponseSchema>
