import { z } from 'zod'
import { DashboardToolProvider } from './dashboard-allocation-protocol'
import { DashboardCodexProcessSchema } from './dashboard-codex-adoption-protocol'

export enum DashboardAgentRestartCode {
  InvalidRequest = 'dashboard_restart_invalid_request',
  TargetChanged = 'dashboard_restart_target_changed',
  ExitUnconfirmed = 'dashboard_restart_exit_unconfirmed',
  Failed = 'dashboard_restart_failed'
}
export class DashboardAgentRestartError extends Error {
  constructor(readonly code: DashboardAgentRestartCode) {
    super(code)
  }
}
const identity = DashboardCodexProcessSchema.pick({
  session_id: true,
  fence: true,
  acquisition_generation: true,
  process: true
})
export const DashboardAgentRestartRequestSchema = identity.extend({
  provider: z.enum(DashboardToolProvider),
  confirm_interrupt: z.literal(true)
})
export type DashboardAgentRestartRequest = z.infer<typeof DashboardAgentRestartRequestSchema>
export const DashboardAgentRestartResultSchema = identity.extend({
  provider: z.enum(DashboardToolProvider),
  previous_exit_observed: z.literal(true)
})
export type DashboardAgentRestartResult = z.infer<typeof DashboardAgentRestartResultSchema>
