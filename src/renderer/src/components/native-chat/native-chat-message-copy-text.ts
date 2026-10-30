import { agentMessageTranscriptText } from '../../../../shared/agent-session/agent-message-display-text'
import { nativeChatMessageCopyText } from '../../../../shared/native-chat-message-copy-text'
import { withoutSentImagePromptMarkers } from '../../../../shared/native-chat/transcript/native-chat-image-transcript-markers'
import { nativeChatStoppedBeforeStartLabel } from './native-chat-stopped-before-start-row'
import type { NativeChatTranscriptSlot } from './native-chat-transcript-slots'

/** The copy text of the transcript row drawing `messageId`, or null when no row draws it. */
export function nativeChatSlotCopyText(
  slots: readonly NativeChatTranscriptSlot[],
  messageId: string
): string | null {
  const slot = slots.find((entry) => entry.kind === 'message' && entry.message.id === messageId)
  return slot?.kind === 'message'
    ? slot.message.from && slot.message.role === 'user'
      ? agentMessageTranscriptText(slot.message.blocks, slot.message.from)
      : nativeChatMessageCopyText(
          { role: slot.message.role, blocks: withoutSentImagePromptMarkers(slot.message) },
          nativeChatStoppedBeforeStartLabel()
        )
    : null
}
