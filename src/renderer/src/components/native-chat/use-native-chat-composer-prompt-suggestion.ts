import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { AgentType } from '../../../../shared/agent-status/contracts/agent-status-types'
import type { NativeChatComposerInput } from './composer/editor/native-chat-composer-input'
import type { NativeChatStructuredComposerTransport } from './composer/submit/native-chat-structured-composer-transport'
import { useNativeChatPromptSuggestion } from './use-native-chat-prompt-suggestion'
import { useNativeChatTypedInsertion } from './composer/editor/use-native-chat-typed-insertion'

/** Fork: a terminal Claude's ghost-text next prompt, read off its screen; structured chats get theirs from the host. */
export function useNativeChatComposerPromptSuggestion(args: {
  agent: AgentType
  structuredTransport: NativeChatStructuredComposerTransport | undefined
  targetPtyId: string | null
  paneKey: string
  /** Composer state that hides the suggestion: disabled, goal mode, working, dictating. */
  blocked: boolean
  /** Attached images also hide it. */
  hasImages: boolean
  readTerminalPromptSuggestion: (() => string | null) | undefined
  isComposing: () => boolean
  draft: string
  /** The same editor handles the composer gives its command picker. */
  editor: {
    textareaRef: RefObject<NativeChatComposerInput | null>
    setDraft: (value: string) => void
    setCaret: Dispatch<SetStateAction<number>>
    setActiveSuggestion: Dispatch<SetStateAction<number>>
  }
}): ReturnType<typeof useNativeChatPromptSuggestion> {
  const { agent, structuredTransport, editor } = args
  const { insertTypedText } = useNativeChatTypedInsertion({
    ...editor,
    isComposing: args.isComposing
  })
  return useNativeChatPromptSuggestion({
    scopeKey: structuredTransport?.sessionId ?? args.targetPtyId ?? args.paneKey,
    enabled:
      agent === 'claude' && structuredTransport === undefined && !args.blocked && !args.hasImages,
    draft: args.draft,
    readTerminalSuggestion: structuredTransport ? undefined : args.readTerminalPromptSuggestion,
    inputRef: editor.textareaRef,
    insertTypedText
  })
}
