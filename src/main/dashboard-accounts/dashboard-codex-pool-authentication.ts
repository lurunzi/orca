import { z } from 'zod'
import {
  CodexPoolIdentitySchema,
  type CodexPoolIdentity
} from '../../shared/agent-session/lifecycle/agent-session-pool-account'
import type { DashboardCodexAllocation } from './dashboard-allocation-protocol'
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
