import type { AgentSessionUsageLimitContinueState as UsageLimitContinueSummary } from '../../../../shared/agent-session/agent-session-usage-limit-continue-wire'
import type { UsageLimitAccountHold } from './structured-agent-session-usage-limit-account-hold'

/** Publishes the account's later reset as `continueAt` only when it outlasts the cut's own reset. */
export function usageLimitContinueSummary(
  cut: { turnItemId: string; resetsAt: number },
  state: UsageLimitContinueSummary['state'],
  hold: UsageLimitAccountHold | null
): UsageLimitContinueSummary {
  const continueAt = hold?.kind === 'wait' && hold.until > cut.resetsAt ? hold.until : undefined
  return {
    turnItemId: cut.turnItemId,
    resetsAt: cut.resetsAt,
    state,
    ...(continueAt ? { continueAt } : {})
  }
}
