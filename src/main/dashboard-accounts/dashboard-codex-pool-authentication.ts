import { z } from 'zod'
import { CodexPoolIdentitySchema } from '../../shared/agent-session/lifecycle/agent-session-pool-account'
import { DashboardCodexProcessSchema } from './dashboard-codex-adoption-protocol'

export const DashboardCodexPoolAuthenticationSchema = z.strictObject({
  identity: CodexPoolIdentitySchema,
  process: DashboardCodexProcessSchema.shape.process
})
export type DashboardCodexPoolAuthentication = z.infer<
  typeof DashboardCodexPoolAuthenticationSchema
>
