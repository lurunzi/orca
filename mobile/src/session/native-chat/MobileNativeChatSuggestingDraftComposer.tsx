import type { ComponentProps } from 'react'
import { MobileNativeChatDraftComposer } from './composer/MobileNativeChatComposer'
import {
  MobileNativeChatPromptSuggestionContext,
  type MobileNativeChatFieldSuggestion
} from './composer/use-mobile-prompt-suggestion'

/** Fork: the draft composer with Claude's prompt suggestion offered to its field. */
export function MobileNativeChatSuggestingDraftComposer({
  promptSuggestion,
  ...props
}: ComponentProps<typeof MobileNativeChatDraftComposer> & {
  promptSuggestion: MobileNativeChatFieldSuggestion | null
}): React.JSX.Element {
  return (
    <MobileNativeChatPromptSuggestionContext value={promptSuggestion}>
      <MobileNativeChatDraftComposer {...props} />
    </MobileNativeChatPromptSuggestionContext>
  )
}
