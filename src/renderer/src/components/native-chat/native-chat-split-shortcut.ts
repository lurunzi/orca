import type { KeyboardEvent } from 'react'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import {
  keybindingMatchesAction,
  type KeybindingInput,
  type KeybindingOverrides
} from '../../../../shared/keybindings'

export type NativeChatSplitDirection = 'right' | 'down'

export function matchNativeChatSplitShortcut(
  input: KeybindingInput,
  platform: NodeJS.Platform,
  keybindings: KeybindingOverrides
): NativeChatSplitDirection | null {
  if (keybindingMatchesAction('terminal.splitRight', input, platform, keybindings)) {
    return 'right'
  }
  if (keybindingMatchesAction('terminal.splitDown', input, platform, keybindings)) {
    return 'down'
  }
  return null
}

/** Runs a terminal pane's split for its shortcut; true when the key was taken. */
export function runNativeChatTerminalSplitShortcut(
  event: KeyboardEvent,
  keybindings: KeybindingOverrides,
  actions: { onSplitRight: () => void; onSplitDown: () => void } | undefined
): boolean {
  const direction = event.repeat
    ? null
    : matchNativeChatSplitShortcut(event, getShortcutPlatform(), keybindings)
  if (!direction || !actions) {
    return false
  }
  event.preventDefault()
  event.stopPropagation()
  if (direction === 'right') {
    actions.onSplitRight()
  } else {
    actions.onSplitDown()
  }
  return true
}
