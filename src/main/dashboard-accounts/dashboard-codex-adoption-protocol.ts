import { z } from 'zod'
import type { AgentSessionProcessIdentity } from '../../shared/agent-session/lifecycle/agent-session-record'

const bindingId = z.string().min(1).max(128)
const positiveVersion = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1)
export const DashboardCodexBindingSchema = z.strictObject({
  account_id: bindingId,
  binding_revision: positiveVersion,
  credential_version: positiveVersion
})
export type DashboardCodexBinding = z.infer<typeof DashboardCodexBindingSchema>
export type DashboardCodexSessionAdoption = {
  binding: DashboardCodexBinding
  process: AgentSessionProcessIdentity
}

const DashboardCodexProcessSchema = z.strictObject({
  session_id: z.string(),
  fence: z.number(),
  acquisition_generation: z.string(),
  process: z.strictObject({
    hostId: z.string(),
    pid: z.number(),
    processStartTimeMs: z.number().nullable(),
    spawnToken: z.string()
  }),
  ...DashboardCodexBindingSchema.shape,
  connection_open: z.boolean(),
  closing: z.boolean()
})
export const DashboardCodexAdoptionStateSchema = z.strictObject({
  pending_acquisitions: z.number().int().min(0),
  processes: z.array(DashboardCodexProcessSchema)
})
export type DashboardCodexAdoptionState = z.infer<typeof DashboardCodexAdoptionStateSchema>

const common = { schema_version: z.literal(1), instance_id: bindingId }
export const DashboardCodexProcessesResponseSchema = z.union([
  z.strictObject({ ...common, supported: z.literal(false) }),
  z.strictObject({
    ...common,
    supported: z.literal(true),
    ...DashboardCodexAdoptionStateSchema.shape
  })
])
export type DashboardCodexProcessesResponse = z.infer<typeof DashboardCodexProcessesResponseSchema>
