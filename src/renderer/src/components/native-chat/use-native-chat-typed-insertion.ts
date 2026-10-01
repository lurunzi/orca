import {
  insertNativeChatPastedText,
  type NativeChatComposerInput
} from './native-chat-composer-input'
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react'
import {
  applyMentionSuggestion,
  type ComposerAutocomplete,
  type HistoryState
} from './native-chat-composer-state'

/** Imperative text insertion and focus for the composer textarea, used by the
 *  paste pipeline and the composer's imperative handle. */
export function useNativeChatTypedInsertion(args: {
  textareaRef: RefObject<NativeChatComposerInput | null>
  caret: number
  draft: string
  setDraft: (value: string) => void
  setCaret: Dispatch<SetStateAction<number>>
  setHistory: Dispatch<SetStateAction<HistoryState>>
  setActiveSuggestion: Dispatch<SetStateAction<number>>
}): {
  insertTypedText: (text: string) => boolean
  insertPastedText: (text: string) => boolean
  focus: () => boolean
  contains: (node: Node | null) => boolean
} {
  const { textareaRef, caret, draft, setDraft, setCaret, setHistory, setActiveSuggestion } = args

  const insertTypedText = useCallback(
    (text: string): boolean => {
      const textarea = textareaRef.current
      if (!textarea || textarea.disabled) {
        return false
      }
      const selectionStart = textarea.selectionStart ?? caret
      const selectionEnd = textarea.selectionEnd ?? selectionStart
      const next = `${draft.slice(0, selectionStart)}${text}${draft.slice(selectionEnd)}`
      const nextCaret = selectionStart + text.length
      textarea.focus()
      setDraft(next)
      setCaret(nextCaret)
      setHistory((prev) => ({ entries: prev.entries, index: null }))
      setActiveSuggestion(0)
      requestAnimationFrame(() => {
        textarea.setSelectionRange(nextCaret, nextCaret)
      })
      return true
    },
    [caret, draft, setActiveSuggestion, setCaret, setDraft, setHistory, textareaRef]
  )

  // Reads the live input when a delayed clipboard read settles.
  const insertPastedText = useCallback(
    (text: string): boolean => insertNativeChatPastedText(textareaRef.current, text),
    [textareaRef]
  )

  const focus = useCallback((): boolean => {
    const textarea = textareaRef.current
    if (!textarea || textarea.disabled) {
      return false
    }
    textarea.focus()
    return true
  }, [textareaRef])

  const contains = useCallback(
    (node: Node | null): boolean => textareaRef.current?.contains?.(node) === true,
    [textareaRef]
  )

  return { insertTypedText, insertPastedText, focus, contains }
}

/** Draft, caret and `@mention` handlers for the composer field; kept here so the
 *  composer stays within its line budget. Also returns typed insertion for the
 *  prompt-suggestion accept path, which the imperative handle does not expose. */
export function useNativeChatComposerTextHandlers(
  args: Parameters<typeof useNativeChatTypedInsertion>[0] & {
    onDraftOrCaretChange: (value: string, caret: number) => void
  }
): {
  insertTypedText: (text: string) => boolean
  handleDraftChange: (value: string, input: NativeChatComposerInput) => void
  handleSelect: (input: NativeChatComposerInput) => void
  acceptMention: (autocomplete: ComposerAutocomplete) => void
} {
  const { textareaRef, caret, draft, setDraft, setCaret, setHistory, setActiveSuggestion } = args
  const { insertTypedText } = useNativeChatTypedInsertion(args)
  const handleSelect = (input: NativeChatComposerInput): void => {
    const position = input.selectionStart ?? input.value.length
    setCaret(position)
    args.onDraftOrCaretChange(input.value, position)
    setActiveSuggestion(0)
  }
  const handleDraftChange = (value: string, input: NativeChatComposerInput): void => {
    setDraft(value)
    setHistory((previous) => ({ entries: previous.entries, index: null }))
    handleSelect(input)
  }
  const acceptMention = (autocomplete: ComposerAutocomplete): void => {
    if (autocomplete.mode !== 'mention') {
      return
    }
    const result = applyMentionSuggestion(draft, caret, autocomplete.query)
    setDraft(result.draft)
    setCaret(result.caret)
    const input = textareaRef.current
    input?.focus()
    requestAnimationFrame(() => input?.setSelectionRange(result.caret, result.caret))
  }
  return { insertTypedText, handleDraftChange, handleSelect, acceptMention }
}
