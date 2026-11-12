import type { AgentSessionUsageLimit } from '../../shared/agent-session/failures/agent-session-usage-limit'
import { acpPromptTurnId } from './timeline/acp-prompt-turns'
import type { AcpStructuredLane } from './journal/acp-structured-lane'

export type AcpAccountUsageFailureDeps = {
  lane: AcpStructuredLane
  usageLimitFromAccount?: (failedAt: number) => Promise<AgentSessionUsageLimit | null>
  now: () => number
}

export function explainAcpFailureFromAccount(
  deps: AcpAccountUsageFailureDeps,
  clientMessageId: string
): void {
  const { lane, usageLimitFromAccount } = deps
  const turn = acpPromptTurnId(clientMessageId)
  if (!usageLimitFromAccount || !lane.translator.failures.unexplained(turn)) {
    return
  }
  usageLimitFromAccount(deps.now()).then(
    (limit) => limit && lane.apply(lane.translator.failures.usageLimitFromAccount(turn, limit)),
    () => {}
  )
}
