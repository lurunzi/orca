import * as z from 'zod'
import { DashboardToolProvider } from '../../dashboard-account-provider'

const id = z.string().min(1).max(128)
const version = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER - 1)

export const CodexPoolIdentitySchema = z.strictObject({
  instanceId: id,
  provider: z.literal(DashboardToolProvider.Codex),
  accountId: id,
  bindingRevision: version,
  credentialVersion: version
})
export type CodexPoolIdentity = z.infer<typeof CodexPoolIdentitySchema>

export enum AgentSessionPoolAccountOrigin {
  Authenticated = 'authenticated',
  InheritedCopy = 'inherited_copy'
}

export const AgentSessionPoolAccountSchema = z.discriminatedUnion('origin', [
  z.strictObject({
    version: z.literal(1),
    ...CodexPoolIdentitySchema.shape,
    origin: z.literal(AgentSessionPoolAccountOrigin.Authenticated)
  }),
  z.strictObject({
    version: z.literal(1),
    ...CodexPoolIdentitySchema.shape,
    origin: z.literal(AgentSessionPoolAccountOrigin.InheritedCopy),
    sourceSessionId: id
  })
])
export type AgentSessionPoolAccount = z.infer<typeof AgentSessionPoolAccountSchema>

export function hasValidPoolAccount(record: Record<string, unknown>): boolean {
  return (
    !Object.hasOwn(record, 'poolAccount') ||
    (record.provider === DashboardToolProvider.Codex &&
      AgentSessionPoolAccountSchema.safeParse(record.poolAccount).success)
  )
}
