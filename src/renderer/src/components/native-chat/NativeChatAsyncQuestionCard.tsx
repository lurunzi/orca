import { useMemo, useState, type ReactNode, type RefObject } from 'react'
import { nativeChatAskDismissKey, type AskPrompt } from '../../../../shared/native-chat-ask'
import {
  extractPendingAsyncAsk,
  formatAsyncAskAnswer
} from '../../../../shared/native-chat-async-ask'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { NativeChatQuestionCard } from './NativeChatQuestionCard'

/**
 * Card for a Codex async question (`request_user_input_async`). The agent keeps
 * running, so the reply is an ordinary chat message and closing only hides the
 * card locally — no selector keystrokes, no Escape interrupt.
 */
export function NativeChatAsyncQuestionCard({
  prompt,
  sendMessage,
  onDone,
  answerInputRef
}: {
  prompt: AskPrompt
  /** Deliver the reply through the chat send path; false keeps the card up for retry. */
  sendMessage: (text: string) => boolean
  onDone: () => void
  answerInputRef?: RefObject<HTMLInputElement | null>
}): React.JSX.Element {
  return (
    <NativeChatQuestionCard
      prompt={prompt}
      answerInputRef={answerInputRef}
      onAnswer={(selections) => {
        const text = formatAsyncAskAnswer(prompt, selections)
        if (text.trim().length > 0 && sendMessage(text)) {
          onDone()
        }
      }}
      onCancel={onDone}
    />
  )
}

/** The pending async question in `messages` unless the user already answered or closed it. */
export function usePendingAsyncAsk(messages: readonly NativeChatMessage[]): {
  prompt: AskPrompt | null
  dismiss: () => void
} {
  const pending = useMemo(() => extractPendingAsyncAsk(messages), [messages])
  const key = nativeChatAskDismissKey(pending)
  const [dismissal, setDismissal] = useState({ key, dismissed: false })
  if (dismissal.key !== key) {
    setDismissal({ key, dismissed: false })
  }
  return {
    prompt: dismissal.key === key && dismissal.dismissed ? null : pending,
    dismiss: () => setDismissal({ key, dismissed: true })
  }
}

/** A structured chat's pending async question, and its card while no blocking prompt is shown. */
export function useStructuredChatAsyncAsk(
  controller: {
    messages: readonly NativeChatMessage[]
    send: (text: string, attachments: []) => boolean | 'queued'
  },
  blockingPrompt: boolean
): { prompt: AskPrompt | null; card: ReactNode } {
  const asyncAsk = usePendingAsyncAsk(controller.messages)
  const prompt = blockingPrompt ? null : asyncAsk.prompt
  return {
    prompt,
    card: prompt ? (
      <NativeChatAsyncQuestionCard
        prompt={prompt}
        sendMessage={(text) => controller.send(text, []) !== false}
        onDone={asyncAsk.dismiss}
      />
    ) : null
  }
}
