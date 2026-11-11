import type { useMobileStructuredAgentSession } from './agent-session/use-mobile-structured-agent-session'

/** The controller fields only a structured session supplies; a terminal chat gets none of them. */
export function mobileNativeChatStructuredControllerFields(
  structured: ReturnType<typeof useMobileStructuredAgentSession> | null
) {
  return {
    nativeChatPromptSuggestion: structured ? structured.promptSuggestion : null,
    nativeChatVisualSource: structured ? structured.visualSource : null,
    nativeChatTurnIndicator: structured ? structured.turnIndicator : null,
    nativeChatTurnJournal: structured ? structured.turnJournal : null,
    nativeChatReceipts: structured ? structured.receipts : null,
    nativeChatSendFollowUp: structured ? structured.sendFollowUp : null,
    nativeChatBackgroundTasks: structured ? structured.backgroundTasks : null,
    nativeChatContextUsage: structured ? structured.contextUsage : null,
    nativeChatInterruptedContinue: structured ? structured.interruptedContinue : null,
    nativeChatThreadGoal: structured ? structured.threadGoal : null,
    nativeChatRewind: structured ? structured.rewind : undefined,
    nativeChatForkSupport: structured ? structured.forkSupport : undefined,
    nativeChatUsageLimit: structured ? structured.usageLimit : null
  }
}
