import { z } from 'zod'
import { DashboardToolProvider } from './dashboard-allocation-protocol'
import {
  DashboardCodexBindingSchema,
  DashboardCodexProcessSchema
} from './dashboard-codex-adoption-protocol'

const bindingId = z.string().min(1).max(128)
export const DashboardCodexRefreshScopeSchema = DashboardCodexProcessSchema.pick({
  session_id: true,
  fence: true,
  acquisition_generation: true,
  process: true
})
export type DashboardCodexRefreshScope = z.infer<typeof DashboardCodexRefreshScopeSchema>

export const DashboardCodexRefreshRequestSchema = z.strictObject({
  ...DashboardCodexRefreshScopeSchema.shape,
  ...DashboardCodexBindingSchema.shape,
  provider: z.literal(DashboardToolProvider.Codex),
  request_id: bindingId,
  deadline_at: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1)
})
export type DashboardCodexRefreshRequest = z.infer<typeof DashboardCodexRefreshRequestSchema>

export const DashboardCodexRefreshStateSchema = z.strictObject({
  requests: z.array(DashboardCodexRefreshRequestSchema)
})
export type DashboardCodexRefreshState = z.infer<typeof DashboardCodexRefreshStateSchema>

const common = { schema_version: z.literal(1), instance_id: bindingId, runtime_id: bindingId }
export const DashboardCodexRefreshesResponseSchema = z.union([
  z.strictObject({ ...common, supported: z.literal(false) }),
  z.strictObject({
    ...common,
    supported: z.literal(true),
    ...DashboardCodexRefreshStateSchema.shape
  })
])
export type DashboardCodexRefreshesResponse = z.infer<typeof DashboardCodexRefreshesResponseSchema>
