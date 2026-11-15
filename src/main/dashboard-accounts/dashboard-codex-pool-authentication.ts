import { z } from 'zod'
import {
  CodexPoolIdentitySchema,
  type CodexPoolIdentity
} from '../../shared/agent-session/lifecycle/agent-session-pool-account'
import {
  DashboardAllocationError,
  DashboardAllocationPendingError,
  type DashboardCodexAllocation
} from './dashboard-allocation-protocol'
import {
  readDashboardCodexAllocationContext,
  type DashboardCodexAllocationContext
} from './dashboard-allocation-reader'
import { DashboardCodexProcessSchema } from './dashboard-codex-adoption-protocol'

export const DashboardCodexPoolAuthenticationSchema = z.strictObject({
  identity: CodexPoolIdentitySchema,
  process: DashboardCodexProcessSchema.shape.process
})
export type DashboardCodexPoolAuthentication = z.infer<
  typeof DashboardCodexPoolAuthenticationSchema
>

export function codexPoolIdentityFromAllocation(
  instanceId: string,
  allocation: DashboardCodexAllocation
): CodexPoolIdentity {
  return CodexPoolIdentitySchema.parse({
    instanceId,
    provider: allocation.provider,
    accountId: allocation.account_id,
    bindingRevision: allocation.binding_revision,
    credentialVersion: allocation.credential_version
  })
}

export function canUseCodexPoolIdentity(
  expected: CodexPoolIdentity,
  current: CodexPoolIdentity
): boolean {
  return (
    expected.instanceId === current.instanceId &&
    expected.provider === current.provider &&
    expected.accountId === current.accountId &&
    current.bindingRevision >= expected.bindingRevision &&
    current.credentialVersion >= expected.credentialVersion
  )
}

/** Reads the Codex binding; a snapshot older than `expected` on the same account is still pending. */
export async function readDashboardCodexPoolContext(
  expected: CodexPoolIdentity | undefined
): Promise<{ context: DashboardCodexAllocationContext; identity: CodexPoolIdentity }> {
  const context = await readDashboardCodexAllocationContext()
  if (!context) {
    throw new DashboardAllocationError()
  }
  const identity = codexPoolIdentityFromAllocation(context.instanceId, context.allocation)
  if (expected && !canUseCodexPoolIdentity(expected, identity)) {
    const stale =
      expected.instanceId === identity.instanceId &&
      expected.provider === identity.provider &&
      expected.accountId === identity.accountId
    throw stale ? new DashboardAllocationPendingError() : new DashboardAllocationError()
  }
  return { context, identity }
}
