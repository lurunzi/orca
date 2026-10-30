import type { NativeChatComposerImageAttachment } from './NativeChatComposerField'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'
import { nativeChatImageSendBlock } from './native-chat-image-reattach'

export type ComposerCriticalAction = {
  kind: 'send' | 'stop' | 'stop-background-tasks'
  disabled: boolean
  /** Why Send is held, when the user can do something about it. */
  sendBlockedReason: string | null
  /** Something other than an empty draft holds Send (saving paste, image, transport). */
  sendHeld: boolean
}

/** What the composer's Send/Stop button does right now. */
export function resolveComposerCriticalAction(
  session: {
    isWorking: boolean
    hasPty: boolean
    disabled: boolean
    onStop?: () => void
    onStopBackgroundTasks?: () => void
    /** Editing a queued message: the button saves it instead of sending or stopping. */
    editSession?: { canSave: boolean }
    structuredTransport?: Pick<
      NativeChatStructuredComposerTransport,
      'sendOut' | 'sendBlockedReason'
    >
  },
  input: {
    draft: string
    imageAttachments: readonly NativeChatComposerImageAttachment[]
    /** A long paste is still being saved as a file the send will reference. */
    pastedTextSaving?: boolean
  }
): ComposerCriticalAction {
  const transport = session.structuredTransport
  const imageBlock = nativeChatImageSendBlock(input.imageAttachments)
  const sendBlockedReason = imageBlock.reason ?? transport?.sendBlockedReason ?? null
  const sendHeld =
    input.pastedTextSaving === true ||
    session.disabled ||
    transport?.sendOut === true ||
    imageBlock.holdsSend ||
    transport?.sendBlockedReason !== undefined
  if (session.editSession) {
    return {
      kind: 'send',
      disabled: sendHeld || !session.editSession.canSave,
      sendBlockedReason,
      sendHeld
    }
  }
  if (session.isWorking) {
    return { kind: 'stop', disabled: !session.hasPty || !session.onStop, sendBlockedReason, sendHeld }
  }
  const draftEmpty = input.draft.trim() === '' && input.imageAttachments.length === 0
  // Why: once the turn settles, background commands are the only work left; a typed draft keeps Send.
  if (session.onStopBackgroundTasks && draftEmpty) {
    return {
      kind: 'stop-background-tasks',
      disabled: session.disabled,
      sendBlockedReason,
      sendHeld
    }
  }
  // A pasted image has no agent-readable path until its save lands; sending
  // mid-save would ship the message without the image the chip promises.
  const hasPendingAttachment = input.imageAttachments.some((attachment) => attachment.pending)
  return {
    kind: 'send',
    disabled: sendHeld || hasPendingAttachment || draftEmpty,
    sendBlockedReason,
    sendHeld
  }
}
