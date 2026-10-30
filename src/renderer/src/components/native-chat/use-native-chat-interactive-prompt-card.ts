import { useMemo } from 'react'
import { useAppStore } from '../../store'
import { extractAntigravityProseQuestion } from '../../../../shared/native-chat-antigravity-prose-question'
import type { AgentType, NativeChatMessage } from '../../../../shared/native-chat-types'
import { resolveNativeChatInteractivePromptCard } from '../../../../shared/native-chat-interactive-prompt'
import { sayNativeChatApprovalTranslated } from './native-chat-interactive-prompt'
import type { InteractivePromptCard } from '../../../../shared/native-chat-interactive-prompt'

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
    const card = resolveNativeChatInteractivePromptCard({
      interactivePrompt,
      toolName: interactiveToolName ?? undefined,
      agent,
      messages,
      transcriptSettled,
      say: sayNativeChatApprovalTranslated
    })
    if (card) {
      return card
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
