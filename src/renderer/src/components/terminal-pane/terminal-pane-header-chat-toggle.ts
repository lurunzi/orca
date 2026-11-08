import type { ComponentProps } from 'react'
import type TerminalPaneHeaderOverlay from './TerminalPaneHeaderOverlay'
import type { TerminalPaneController } from './use-terminal-pane-controller'

type HeaderChatToggleProps = Pick<
  ComponentProps<typeof TerminalPaneHeaderOverlay>,
  'canShowTerminal' | 'canShowChat' | 'onToggleNativeChat' | 'canResumeInNewNativeChat'
>

/** The active pane's header switch between its native chat and its terminal. */
export function terminalPaneHeaderChatToggleProps(
  controller: TerminalPaneController
): HeaderChatToggleProps {
  return {
    canShowTerminal: controller.activePaneIsChatLeaf,
    canShowChat: controller.activePaneCanToggleChat && !controller.activePaneIsChatLeaf,
    onToggleNativeChat: controller.handleToggleNativeChat,
    canResumeInNewNativeChat: controller.activePaneCanResumeInChat
  }
}
