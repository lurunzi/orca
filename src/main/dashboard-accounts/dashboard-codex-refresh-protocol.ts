import { z } from 'zod'
import { DashboardToolProvider } from './dashboard-allocation-protocol'
import {
  DashboardCodexBindingSchema,
  DashboardCodexProcessSchema
} from './dashboard-codex-adoption-protocol'

export enum DashboardCodexRefreshSource {
  Session = 'session',
  ShortLivedOperation = 'short_lived_operation'
}

export enum DashboardCodexRefreshOperation {
  ReadAccountUsage = 'read_account_usage',
  CopyConversation = 'copy_conversation',
  RenameSession = 'rename_session'
}

const bindingId = z.string().min(1).max(128)
const process = DashboardCodexProcessSchema.shape.process
const sessionScope = z.strictObject({
  source: z.literal(DashboardCodexRefreshSource.Session),
  ...DashboardCodexProcessSchema.pick({
    session_id: true,
    fence: true,
    acquisition_generation: true
  }).shape,
  process
})
const operationScope = z.strictObject({
  source: z.literal(DashboardCodexRefreshSource.ShortLivedOperation),
  operation_id: bindingId,
  operation: z.enum(DashboardCodexRefreshOperation),
  source_session_id: bindingId,
  process
})
export const DashboardCodexRefreshScopeSchema = z.discriminatedUnion('source', [
  sessionScope,
  operationScope
])
export type DashboardCodexRefreshScope = z.infer<typeof DashboardCodexRefreshScopeSchema>

const request = {
  ...DashboardCodexBindingSchema.shape,
  provider: z.literal(DashboardToolProvider.Codex),
  request_id: bindingId,
  deadline_at: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1)
}
export const DashboardCodexRefreshRequestSchema = z.discriminatedUnion('source', [
  sessionScope.extend(request),
  operationScope.extend(request)
])
export type DashboardCodexRefreshRequest = z.infer<typeof DashboardCodexRefreshRequestSchema>

export const DashboardCodexRefreshStateSchema = z.strictObject({
  requests: z.array(DashboardCodexRefreshRequestSchema)
})
export type DashboardCodexRefreshState = z.infer<typeof DashboardCodexRefreshStateSchema>

const common = { schema_version: z.literal(2), instance_id: bindingId, runtime_id: bindingId }
export const DashboardCodexRefreshesResponseSchema = z.union([
  z.strictObject({ ...common, supported: z.literal(false) }),
  z.strictObject({
    ...common,
    supported: z.literal(true),
    ...DashboardCodexRefreshStateSchema.shape
  })
])
export type DashboardCodexRefreshesResponse = z.infer<typeof DashboardCodexRefreshesResponseSchema>
