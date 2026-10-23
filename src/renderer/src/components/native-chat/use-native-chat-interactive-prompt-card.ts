import { useMemo } from 'react'
import { useAppStore } from '../../store'
import { resolveNativeChatAsk } from '../../../../shared/native-chat-ask'
import { extractPendingAsyncAsk } from '../../../../shared/native-chat-async-ask'
import { extractAntigravityProseQuestion } from '../../../../shared/native-chat-antigravity-prose-question'
import type { AgentType, NativeChatMessage } from '../../../../shared/native-chat-types'
import {
  parseInteractivePrompt,
  type InteractivePromptCard
} from './native-chat-interactive-prompt'

/**
 * The prompt a terminal-backed pane can draw as a card: a tool approval from the
 * live status, else a question from the live status or, failing that, from the
 * transcript's unresolved ask (headless host, relay gap, replay, reconnect — a
 * pane parked on a selector must not take the next message as its answer, #11761).
 */
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
  // The sibling `toolName` lets the question parser dispatch through the tool's
  // registered parser (mobile parity). Read only beside a prompt: it changes on
  // every tool call, and this hook re-renders the whole pane.
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
    // A blocking question wins; an async one is answered by a chat message instead.
    const asyncPrompt = transcriptSettled ? extractPendingAsyncAsk(messages) : null
    if (asyncPrompt) {
      return { kind: 'question' as const, prompt: asyncPrompt, async: true }
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
