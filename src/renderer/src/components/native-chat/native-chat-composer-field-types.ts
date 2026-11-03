import type { ClipboardEventHandler, KeyboardEventHandler, RefObject } from 'react'
import type { useImeEnterGestureOwnership } from '@/lib/ime-composition-keyboard-event'
import type { ComposerAutocomplete } from '../../../../shared/native-chat/input/native-chat-composer-autocomplete'
import type { NativeChatPickerItem } from '../../../../shared/native-chat/input/native-chat-picker-items'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface
} from '../../../../shared/native-chat/input/native-chat-session-options'
import type { NativeChatFollowUpBehavior } from '../../../../shared/native-chat/input/native-chat-follow-up-behavior'
import type { NativeChatComposerInput } from './native-chat-composer-input'
import type { NativeChatMentionFiles } from './use-native-chat-mention-files'
import type { NativeChatComposerNotice } from './native-chat-composer-notice'
import type { NativeChatContextUsageSummary } from './native-chat-context-usage-summary'
import type { CoordinatorUnavailableReason } from './NativeChatCoordinatorToggle'
import type { NativeChatAfterStopSend } from './native-chat-composer-target'
import type { NativeChatOptionPickerRequest } from './native-chat-composer-types'
import type { NativeChatComposerGoalMode } from './use-native-chat-composer-submit'

export type NativeChatComposerFieldProps = {
  editSession?: { cancel: () => void }
  /** Own draft persistence and native-drop routing by this pane so drops cannot land in another composer. */
  draftScopeKey: string
  positionTarget?: string
  textareaRef: RefObject<NativeChatComposerInput | null>
  draft: string
  promptSuggestion?: string | null
  onAcceptPromptSuggestion?: () => void
  disabled: boolean
  hasPty: boolean
  canSend: boolean
  unavailableHint?: string | undefined
  autocomplete: ComposerAutocomplete
  mentionFiles: NativeChatMentionFiles
  activeSuggestion: number
  notices: readonly NativeChatComposerNotice[]
  imageAttachments: readonly NativeChatComposerImageAttachment[]
  /** A structured chat numbers its images, as its chips in the prompt read. */
  numberImages?: boolean
  /** The paired server a structured chat runs on, which reads back files stored there. */
  attachmentEnvironmentId?: string
  sendButtonDisabled: boolean
  /** Why the send button is disabled, when the user can do something about it. */
  sendBlockedReason?: string | null
  isWorking: boolean
  /** Forces the critical button to read Stop, e.g. to stop background tasks after a turn. */
  showStop?: boolean
  /** The draft holds text or images, so Send takes Stop's place while the agent works. */
  hasDraft?: boolean
  /** While the agent works: what Cmd/Ctrl+Enter would do instead of a plain send, when it differs. */
  alternateSend?: NativeChatFollowUpBehavior
  /** This client's Stop request is in flight: the Stop control is disabled and says so. */
  isStopping?: boolean
  /** After Stop, describe whether the host queues the next message as a card or holds the send. */
  afterStop?: NativeChatAfterStopSend
  attachDisabled: boolean
  dictationDisabled: boolean
  isDictating: boolean
  isDictationHoldMode: boolean
  imeEnterGesture: ReturnType<typeof useImeEnterGestureOwnership>
  onDraftChange: (value: string, element: NativeChatComposerInput) => void
  onTextareaSelect: (element: NativeChatComposerInput) => void
  onKeyDown: KeyboardEventHandler<HTMLElement>
  onImeSettled: (element: NativeChatComposerInput) => void
  onPaste: ClipboardEventHandler<HTMLElement>
  pickerListboxId: string
  onChoosePickerItem: (item: NativeChatPickerItem) => void
  onRetrySkills: () => void
  onChooseMentionFile: (path: string) => void
  onRemoveImageAttachment: (id: string) => void
  onAttach: () => void
  /** Session that can take a coordinator identity, or why this chat cannot. */
  coordinator?: { sessionId: string | null; unavailableReason?: CoordinatorUnavailableReason }
  onDictationToggle: () => void
  onDictationHoldStart: () => void
  onDictationHoldEnd: () => void
  onSend: () => void
  onStop?: () => void
  sessionOptionsSurface: SessionOptionsSurface | null
  sessionOptionsSnapshot: SessionOptionDescriptor[]
  contextUsage?: NativeChatContextUsageSummary | null
  sessionOptionsPickerRequest?: NativeChatOptionPickerRequest | null
  goalMode?: NativeChatComposerGoalMode
  agent?: string
  launchPrompt?: { placeholder: string }
}

export type NativeChatComposerImageAttachment = {
  id: string
  /** Empty while `pending`: the clipboard image has no agent-readable path yet. */
  path: string
  connectionId?: string
  /** Show clipboard thumbnails immediately, without waiting for disk/upload completion. */
  previewUrl?: string
  /** True while the pasted image is still being written to disk or uploaded. */
  pending?: boolean
  /** The file's name while it uploads: a dropped or picked file, not a pasted image. */
  pendingName?: string
  /** Set on an image the draft names but can't send: the file to attach again. */
  unavailableName?: string
}
