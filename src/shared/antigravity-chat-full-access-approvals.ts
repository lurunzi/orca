import { z } from 'zod'

/** Who answers tool approvals in a Full access chat on the host's agy: Orca, or agy's own flag. */
export const AntigravityChatFullAccessApprovalsSchema = z.enum(['orca', 'agent'])

export type AntigravityChatFullAccessApprovals = z.infer<
  typeof AntigravityChatFullAccessApprovalsSchema
>

export type AntigravityChatFullAccessApprovalsSettings = {
  antigravityChatFullAccessApprovals?: AntigravityChatFullAccessApprovals
}

export const AntigravityChatFullAccessApprovalsParams = z.strictObject({
  approvals: AntigravityChatFullAccessApprovalsSchema
})

/** Anything but a saved `agent` keeps Orca answering. */
export function resolveAntigravityChatFullAccessApprovals(
  value: unknown
): AntigravityChatFullAccessApprovals {
  return value === 'agent' ? 'agent' : 'orca'
}
