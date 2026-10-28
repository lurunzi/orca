import { useMemo } from 'react'
import { useAppStore } from '../../store'
import { resolveNativeChatAsk } from '../../../../shared/native-chat-ask'
import { extractAntigravityProseQuestion } from '../../../../shared/native-chat-antigravity-prose-question'
import type { AgentType, NativeChatMessage } from '../../../../shared/native-chat-types'
import {
  parseInteractivePrompt,
  type InteractivePromptCard
} from './native-chat-interactive-prompt'

/** Prefer live approvals/questions, then unresolved transcript asks, so a parked selector cannot consume the next message as its answer. */
export function useNativeChatInteractivePromptCard({
  paneKey,
  messages,
  transcriptSettled,
  agent: paneAgent,
  awaitingInput = false
}: {
  paneKey: string
  /** Pass the command-boundary-trimmed messages so an ask abandoned via `/clear` stays gone. */
  messages: readonly NativeChatMessage[]
  transcriptSettled: boolean
  agent?: AgentType
  awaitingInput?: boolean
}): InteractivePromptCard {
  const interactivePrompt = useAppStore(
    (s) => s.agentStatusByPaneKey[paneKey]?.interactivePrompt ?? null
  )
  // Read toolName only beside a prompt for parser dispatch; ordinary tool changes would rerender the whole pane.
  const interactiveToolName = useAppStore((s) => {
    const entry = s.agentStatusByPaneKey[paneKey]
    return entry?.interactivePrompt ? (entry.toolName ?? null) : null
  })
  const statusAgent = useAppStore((s) => s.agentStatusByPaneKey[paneKey]?.agentType)
  const agent = paneAgent ?? statusAgent
  return useMemo(() => {
    const statusCard = parseInteractivePrompt(
      interactivePrompt,
      interactiveToolName ?? undefined,
      agent
    )
    if (statusCard?.kind === 'approval') {
      return statusCard
    }
    const prompt = resolveNativeChatAsk({
      liveAsk: statusCard?.prompt ?? null,
      messages,
      transcriptSettled
    })
    if (prompt) {
      return { kind: 'question' as const, prompt }
    }
    const proseQuestion =
      agent === 'antigravity' && awaitingInput && transcriptSettled && !interactivePrompt
        ? extractAntigravityProseQuestion(messages)
        : null
    return proseQuestion
      ? { kind: 'question' as const, ...proseQuestion, replyAsMessage: true }
      : null
  }, [interactivePrompt, interactiveToolName, agent, awaitingInput, messages, transcriptSettled])
}
