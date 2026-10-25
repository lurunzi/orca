import {
  useCallback,
  useMemo,
  type KeyboardEventHandler,
  type ReactNode,
  type RefObject
} from 'react'
import { useAppStore } from '@/store'
import { formatShortcutLabel } from '@/hooks/useShortcutLabel'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { isOrcaSessionId } from '../../../../shared/orca-session-address'
import { resolveStructuredSessionOrcaSessionId } from '../../runtime/structured-session-orca-session-id'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { NativeChatComposerHandle } from './NativeChatComposer'
import { useNativeChatPasteBridge } from './use-native-chat-paste-bridge'
import {
  emptyNativeChatContextMenuActions,
  useNativeChatContextMenu,
  type NativeChatContextMenuActions,
  type NativeChatContextMenuTargetArgs
} from './use-native-chat-context-menu'
import { matchNativeChatSplitShortcut } from './native-chat-split-shortcut'
import { runNativeChatSplitTarget } from './native-chat-layout-actions'
import { useStructuredChatSessionActions } from './use-structured-chat-session-actions'
import {
  useStructuredNativeChatInbox,
  type StructuredNativeChatInboxController
} from './use-structured-native-chat-inbox'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'

export function useStructuredNativeChatPaneCommands({
  tabId,
  ownerWorktreeId,
  groupId,
  isVisible,
  rootRef,
  composerRef,
  questionAnswerInputRef,
  terminalPaneActions,
  sessionMenuItems,
  sessionId,
  target,
  chat,
  ...menuTargets
}: {
  tabId: string
  ownerWorktreeId: string | null
  groupId?: string
  isVisible: boolean
  rootRef: RefObject<HTMLDivElement | null>
  composerRef: RefObject<NativeChatComposerHandle | null>
  questionAnswerInputRef: RefObject<HTMLInputElement | null>
  terminalPaneActions?: Omit<NativeChatContextMenuActions, 'onPaste'>
  sessionMenuItems?: ReactNode
  sessionId: string
  target: RuntimeClientTarget
  /** Fork: the chat behind the header cluster, its session menu items and Inbox. */
  chat: Pick<Parameters<typeof useStructuredChatSessionActions>[0], 'agent' | 'paneKey'> & {
    controller: StructuredNativeChatInboxController & {
      messages: readonly NativeChatMessage[]
    }
  }
} & NativeChatContextMenuTargetArgs) {
  const { controller } = chat
  const inbox = useStructuredNativeChatInbox(
    { agent: chat.agent, sessionId, tabId, target },
    controller,
    composerRef,
    menuTargets.fileLinkContext?.worktreePath ?? null
  )
  const sessionActions = useStructuredChatSessionActions({
    agent: chat.agent,
    paneKey: chat.paneKey,
    messages: controller.messages,
    fileLinkContext: menuTargets.fileLinkContext ?? null,
    inbox: inbox.button,
    tabId,
    groupId,
    sessionId,
    target,
    hasTerminalPaneActions: terminalPaneActions !== undefined
  })
  const keybindings = useAppStore((state) => state.keybindings)
  const resolveOrcaSessionId = useMemo(
    () =>
      isOrcaSessionId(sessionId)
        ? () => resolveStructuredSessionOrcaSessionId(target, sessionId)
        : undefined,
    [sessionId, target]
  )
  const pasteClipboardIntoComposer = useNativeChatPasteBridge({
    rootRef,
    composerRef,
    questionAnswerInputRef
  })
  const contextMenu = useNativeChatContextMenu({
    ...menuTargets,
    rootRef,
    actions: {
      ...emptyNativeChatContextMenuActions,
      ...terminalPaneActions,
      onPaste: pasteClipboardIntoComposer
    },
    enabled: isVisible,
    sessionMenuItems: sessionMenuItems ?? sessionActions.menuItems,
    resolveOrcaSessionId,
    composerRef,
    showTerminalPaneActions: terminalPaneActions !== undefined,
    splitShortcutLabels: {
      right: formatShortcutLabel('terminal.splitRight', keybindings),
      down: formatShortcutLabel('terminal.splitDown', keybindings)
    },
    chatPane:
      ownerWorktreeId && groupId && terminalPaneActions === undefined
        ? { tabId, worktreeId: ownerWorktreeId, groupId }
        : undefined
  })
  const onKeyDownCapture = useCallback<KeyboardEventHandler<HTMLDivElement>>(
    (event) => {
      if (event.repeat) {
        return
      }
      const direction = matchNativeChatSplitShortcut(event, getShortcutPlatform(), keybindings)
      if (!direction) {
        return
      }
      let handled = false
      if (terminalPaneActions) {
        if (direction === 'right') {
          terminalPaneActions.onSplitRight()
        } else {
          terminalPaneActions.onSplitDown()
        }
        handled = true
      } else if (groupId) {
        handled = runNativeChatSplitTarget(
          { kind: 'workspace-tab', unifiedTabId: tabId, groupId },
          direction
        )
      }
      if (!handled) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
    },
    [groupId, keybindings, tabId, terminalPaneActions]
  )

  return {
    ...contextMenu,
    onKeyDownCapture,
    header: sessionActions.header,
    titleActions: sessionActions.titleActions,
    headerDialog: sessionActions.dialog,
    inbox
  }
}
