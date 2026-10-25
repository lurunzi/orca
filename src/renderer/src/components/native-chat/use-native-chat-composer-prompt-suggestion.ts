import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { NativeChatComposerInput } from './native-chat-composer-input'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'
import { useNativeChatPromptSuggestion } from './use-native-chat-prompt-suggestion'
import { useNativeChatTypedInsertion } from './use-native-chat-typed-insertion'

/** The composer's ghost-text next prompt: Claude from the host or its terminal, Codex from the host. */
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
      (agent === 'claude' || (agent === 'codex' && structuredTransport !== undefined)) &&
      !args.blocked &&
      !args.hasImages,
    draft: args.draft,
    suggestion: structuredTransport?.promptSuggestion,
    readTerminalSuggestion: structuredTransport ? undefined : args.readTerminalPromptSuggestion,
    inputRef: editor.textareaRef,
    insertTypedText
  })
}
