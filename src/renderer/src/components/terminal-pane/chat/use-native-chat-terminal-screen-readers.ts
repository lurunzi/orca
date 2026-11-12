import { useCallback } from 'react'
import { readClaudeTerminalPromptSuggestion } from '../../../../../shared/claude-terminal-prompt-suggestion'
import { readTerminalCursorLineContext } from '../../../../../shared/terminal/input/terminal-cursor-line-context'
import { readTerminalComposerTypedText } from '../../../../../shared/terminal/input/terminal-composer-draft'
import type { TerminalPaneTitleController } from '../titles/use-terminal-pane-title-state'

/** Reads the chat leaf's live terminal screen for the native chat composer. */
export function useNativeChatTerminalScreenReaders(
  managerRef: TerminalPaneTitleController['managerRef'],
  chatLeafId: TerminalPaneTitleController['chatLeafId']
) {
  const findNativeChatPane = useCallback(
    () =>
      chatLeafId
        ? managerRef.current?.getPanes().find((candidate) => candidate.leafId === chatLeafId)
        : undefined,
    [chatLeafId, managerRef]
  )

  const readNativeChatTerminalScreen = useCallback(
    (format?: 'text'): string | null => {
      const pane = findNativeChatPane()
      if (!pane) {
        return null
      }
      if (format === 'text') {
        const buffer = pane.terminal.buffer.active
        return Array.from(
          { length: pane.terminal.rows },
          (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? ''
        )
          .join('\n')
          .trimEnd()
      }
      return pane.serializeAddon.serialize({ scrollback: 0 })
    },
    [findNativeChatPane]
  )

  const readNativeChatPromptSuggestion = useCallback((): string | null => {
    const pane = findNativeChatPane()
    return pane ? readClaudeTerminalPromptSuggestion(pane.terminal) : null
  }, [findNativeChatPane])

  const readNativeChatTerminalDraft = useCallback((): string | null => {
    const pane = findNativeChatPane()
    return pane
      ? readTerminalComposerTypedText(
          readTerminalCursorLineContext(pane.terminal, pane.terminal.rows)
        )
      : null
  }, [findNativeChatPane])

  return {
    readNativeChatTerminalScreen,
    readNativeChatPromptSuggestion,
    readNativeChatTerminalDraft
  }
}
