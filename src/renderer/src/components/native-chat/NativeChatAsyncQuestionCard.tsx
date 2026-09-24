import { useEffect, useMemo, useState, type RefObject } from 'react'
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
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  // A superseded question clears the dismissal so a later identical ask shows again.
  useEffect(() => {
    if (key === null) {
      setDismissedKey(null)
    }
  }, [key])
  return {
    prompt: key !== null && key !== dismissedKey ? pending : null,
    dismiss: () => setDismissedKey(key)
  }
}
