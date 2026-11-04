import { z } from 'zod'

export enum DashboardToolProvider {
  Codex = 'codex',
  ClaudeCode = 'claude_code'
}
export enum DashboardAllocationState {
  Unassigned = 'unassigned',
  Available = 'available',
  Unavailable = 'unavailable'
}
export enum DashboardAllocationReason {
  Unverified = 'unverified',
  CredentialInvalid = 'credential_invalid',
  CredentialExpired = 'credential_expired',
  RefreshPending = 'refresh_pending',
  Unsupported = 'unsupported',
  ConfigurationMissing = 'configuration_missing'
}
export enum DashboardAllocationErrorCode {
  Unavailable = 'dashboard_allocation_unavailable'
}
export class DashboardAllocationError extends Error {
  readonly code = DashboardAllocationErrorCode.Unavailable
  constructor() {
    super(DashboardAllocationErrorCode.Unavailable)
  }
}

export const DASHBOARD_ALLOCATION_LIMIT_BYTES = 1024 * 1024
const id = z.string().min(1).max(128)
const revision = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1)
const positive = revision.min(1)
const access = {
  access_token: z.string().min(1).max(65536),
  expires_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
    .nullable()
}
function variants<P extends DashboardToolProvider>(provider: P) {
  const assigned = {
    provider: z.literal(provider),
    account_id: id,
    binding_revision: positive,
    credential_version: positive
  }
  return {
    assigned,
    unassigned: z.strictObject({
      provider: z.literal(provider),
      state: z.literal(DashboardAllocationState.Unassigned),
      account_id: z.null(),
      binding_revision: revision,
      credential_version: z.literal(0)
    }),
    unavailable: z.strictObject({
      ...assigned,
      state: z.literal(DashboardAllocationState.Unavailable),
      reason: z.enum(DashboardAllocationReason)
    })
  }
}
const codex = variants(DashboardToolProvider.Codex)
const claude = variants(DashboardToolProvider.ClaudeCode)
export const DashboardAllocationSnapshotSchema = z.strictObject({
  schema_version: z.literal(1),
  instance_id: id,
  bindings: z.tuple([
    z.union([
      codex.unassigned,
      codex.unavailable,
      z.strictObject({
        ...codex.assigned,
        state: z.literal(DashboardAllocationState.Available),
        ...access,
        chatgpt_account_id: z.string().min(1).max(256)
      })
    ]),
    z.union([
      claude.unassigned,
      claude.unavailable,
      z.strictObject({
        ...claude.assigned,
        state: z.literal(DashboardAllocationState.Available),
        ...access
      })
    ])
  ])
})
function statusVariants<P extends DashboardToolProvider>(provider: P) {
  const binding = variants(provider)
  return z.union([
    binding.unassigned,
    binding.unavailable,
    z.strictObject({
      ...binding.assigned,
      state: z.literal(DashboardAllocationState.Available),
      expires_at: access.expires_at
    })
  ])
}
export const DashboardAllocationStatusSchema = z.strictObject({
  schema_version: z.literal(1),
  instance_id: id,
  bindings: z.tuple([
    statusVariants(DashboardToolProvider.Codex),
    statusVariants(DashboardToolProvider.ClaudeCode)
  ]),
  process_reporting_supported: z.literal(false)
})
export type DashboardAllocationStatus = z.infer<typeof DashboardAllocationStatusSchema>
export type DashboardAllocationSnapshot = z.infer<typeof DashboardAllocationSnapshotSchema>
export type DashboardCodexAllocation = Extract<
  DashboardAllocationSnapshot['bindings'][0],
  { state: DashboardAllocationState.Available }
>
export type DashboardClaudeAllocation = Extract<
  DashboardAllocationSnapshot['bindings'][1],
  {
    state: DashboardAllocationState.Available
  }
>
export function parseDashboardAllocation(
  value: unknown,
  instanceId: string
): DashboardAllocationSnapshot {
  const result = DashboardAllocationSnapshotSchema.safeParse(value)
  if (!result.success || result.data.instance_id !== instanceId) {
    throw new DashboardAllocationError()
  }
  return result.data
}
