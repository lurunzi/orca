import type { NativeChatComposerImageAttachment } from './NativeChatComposerField'

export type ComposerCriticalAction = {
  kind: 'send' | 'stop' | 'stop-background-tasks'
  disabled: boolean
}

/** What the composer's Send/Stop button does right now. */
export function resolveComposerCriticalAction(
  session: {
    isWorking: boolean
    hasPty: boolean
    disabled: boolean
    onStop?: () => void
    onStopBackgroundTasks?: () => void
  },
  input: { draft: string; imageAttachments: readonly NativeChatComposerImageAttachment[] }
): ComposerCriticalAction {
  if (session.isWorking) {
    return { kind: 'stop', disabled: !session.hasPty || !session.onStop }
  }
  const draftEmpty = input.draft.trim() === '' && input.imageAttachments.length === 0
  // Why: once the turn settles, background commands are the only work left; a typed draft keeps Send.
  if (session.onStopBackgroundTasks && draftEmpty) {
    return { kind: 'stop-background-tasks', disabled: session.disabled }
  }
  // A pasted image has no agent-readable path until its save lands; sending
  // mid-save would ship the message without the image the chip promises.
  const hasPendingAttachment = input.imageAttachments.some((attachment) => attachment.pending)
  return { kind: 'send', disabled: session.disabled || hasPendingAttachment || draftEmpty }
}
