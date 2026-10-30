import { useCallback } from 'react'
import { readClaudeTerminalPromptSuggestion } from '../../../../shared/claude-terminal-prompt-suggestion'
import type { TerminalPaneTitleController } from './use-terminal-pane-title-state'

/** Reads the chat leaf's live terminal screen for the native chat composer. */
export function useNativeChatTerminalScreenReaders(
  managerRef: TerminalPaneTitleController['managerRef'],
  chatLeafId: TerminalPaneTitleController['chatLeafId']
) {
  const readNativeChatTerminalScreen = useCallback(
    (format?: 'text'): string | null => {
      if (!chatLeafId) {
        return null
      }
      const pane = managerRef.current
        ?.getPanes()
        .find((candidate) => candidate.leafId === chatLeafId)
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
    [chatLeafId, managerRef]
  )

  const readNativeChatPromptSuggestion = useCallback((): string | null => {
    const pane = managerRef.current?.getPanes().find((candidate) => candidate.leafId === chatLeafId)
    return pane ? readClaudeTerminalPromptSuggestion(pane.terminal) : null
  }, [chatLeafId, managerRef])

  return { readNativeChatTerminalScreen, readNativeChatPromptSuggestion }
}
