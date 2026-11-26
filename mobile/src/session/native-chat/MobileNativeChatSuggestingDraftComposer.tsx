import type { ComponentProps } from 'react'
import { MobileNativeChatDraftComposer } from './composer/MobileNativeChatDraftComposer'
import {
  MobileNativeChatPromptSuggestionContext,
  mobileNativeChatFieldSuggestion
} from './composer/use-mobile-prompt-suggestion'
import type { MobileNativeChatController } from './mobile-native-chat-controller-contract'

/** Fork: the draft composer with Claude's prompt suggestion offered to its field. */
export function MobileNativeChatSuggestingDraftComposer({
  suggestionController,
  ...props
}: ComponentProps<typeof MobileNativeChatDraftComposer> & {
  suggestionController: MobileNativeChatController | null
}): React.JSX.Element {
  // The composer's own lock, dictation and attachments decide when the field may offer one.
  const promptSuggestion = suggestionController
    ? mobileNativeChatFieldSuggestion(suggestionController, {
        scopeKey: `${props.sendSurfaceId}:${props.draftScopeKey ?? ''}`,
        blocked: Boolean(props.disabled || props.offline || props.micActive || props.isAttaching),
        attachmentCount: (props.attachments?.length ?? 0) + (props.structured?.files.length ?? 0),
        getFocusGeneration: props.getSendCompletionGeneration
      })
    : null
  return (
    <MobileNativeChatPromptSuggestionContext value={promptSuggestion}>
      <MobileNativeChatDraftComposer {...props} />
    </MobileNativeChatPromptSuggestionContext>
  )
}
