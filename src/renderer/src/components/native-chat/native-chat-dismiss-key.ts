import { nativeChatAskDismissKey } from '../../../../shared/native-chat-ask'
import type { InteractivePromptCard } from './native-chat-interactive-prompt'

/** Equal content keys identify the same prompt; null means no card. */
export function nativeChatCardDismissKey(card: InteractivePromptCard): string | null {
  if (!card) {
    return null
  }
  if (card.kind === 'question') {
    const content = nativeChatAskDismissKey(card.prompt)
    return card.sourceMessageId ? `${card.sourceMessageId}:${content}` : content
  }
  return `approval:${card.approval.title}:${card.approval.detail ?? ''}`
}
