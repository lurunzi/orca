import { z } from 'zod'
import { DashboardToolProvider } from './dashboard-allocation-protocol'
import { DashboardCodexProcessSchema } from './dashboard-codex-adoption-protocol'

export enum DashboardAgentRestartCode {
  InvalidRequest = 'dashboard_restart_invalid_request',
  TargetChanged = 'dashboard_restart_target_changed',
  ExitUnconfirmed = 'dashboard_restart_exit_unconfirmed',
  Failed = 'dashboard_restart_failed',
  Unavailable = 'dashboard_restart_unavailable',
  OutcomeUnknown = 'dashboard_restart_outcome_unknown'
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

const localIdentity = {
  schema_version: z.literal(1),
  instance_id: z.string().min(1).max(128),
  runtime_id: z.string().min(1).max(128)
}
export const DashboardAgentRestartParamsSchema = z.strictObject({
  ...localIdentity,
  target: DashboardAgentRestartRequestSchema
})
export const DashboardAgentRestartResponseSchema = z.strictObject({
  ...localIdentity,
  result: DashboardAgentRestartResultSchema
})
export type DashboardAgentRestartParams = z.infer<typeof DashboardAgentRestartParamsSchema>
export const DASHBOARD_AGENT_RESTART_LIMIT_BYTES = 16 * 1024
export const DASHBOARD_AGENT_RESTART_TIMEOUT_MS = 120_000
