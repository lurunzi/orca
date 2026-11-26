import { useCallback, useMemo, type ReactNode } from 'react'
import { isOrcaSessionId } from '../../../../../../shared/agent-session/identity/orca-session-address'
import { resolveStructuredSessionOrcaSessionId } from '../../../../runtime/native-chat/orchestration/structured-session-orca-session-id'
import type { NativeChatStructuredViewProps } from '../../native-chat-view-types'
import type { NativeChatHandOff } from './use-native-chat-hand-off'
import {
  runNativeChatTerminalPaneShortcut,
  type NativeChatPaneShortcut
} from '../routing/native-chat-pane-shortcut'
import type { NativeChatSurfaceMenu } from '../../use-native-chat-surface'
import { runNativeChatSplitTarget } from '../routing/native-chat-layout-actions'
import { useStructuredChatSessionActions } from '../../use-structured-chat-session-actions'
import {
  useStructuredNativeChatInbox,
  type StructuredNativeChatInboxController
} from '../../use-structured-native-chat-inbox'
import type { NativeChatMessage } from '../../../../../../shared/native-chat/native-chat-types'
import { structuredAgentSessionPaneKey } from '../../../../../../shared/agent-session/view/structured-agent-session-projection'
import type { NativeChatComposerHandle } from '../../composer/native-chat-composer-types'
import { useNativeChatFileLinkContext } from '../../links/actions/use-native-chat-file-link-context'
import { structuredChatPaneHeader } from './NativeChatPaneHeader'

/** A structured chat's own menu rows and split target, for its chat surface. */
export function useStructuredNativeChatPaneCommands({
  pane,
  handOff,
  ownerWorktreeId,
  composerRef,
  sessionContext,
  rewind,
  sessionMenuItems
}: {
  pane: Omit<NativeChatStructuredViewProps, 'mode'>
  handOff: NativeChatHandOff
  /** Fork: also the chat behind the header cluster's session menu items and Inbox. */
  sessionContext: StructuredNativeChatInboxController & { messages: readonly NativeChatMessage[] }
  ownerWorktreeId: string | null
  composerRef: React.RefObject<NativeChatComposerHandle | null>
  rewind?: NativeChatSurfaceMenu['rewind']
  sessionMenuItems?: ReactNode
}): {
  menu: NativeChatSurfaceMenu
  onSplit: (shortcut: NativeChatPaneShortcut) => boolean
  /** Fork: the pane header carrying the session's Inbox and continue actions. */
  paneHeader: (appearance: Pick<React.CSSProperties, 'colorScheme'>) => React.JSX.Element
} {
  const { tabId, groupId, isVisible, sessionId, target } = pane
  const terminalPaneActions = pane.contextMenuActions
  // Fork: the chat's folder, for its Inbox and continue-in-new-session actions.
  const fileLinkContext = useNativeChatFileLinkContext(tabId)
  const inbox = useStructuredNativeChatInbox(
    { agent: pane.agent, sessionId, tabId, target },
    sessionContext,
    composerRef,
    fileLinkContext?.worktreePath ?? null
  )
  const sessionActions = useStructuredChatSessionActions({
    agent: pane.agent,
    paneKey: structuredAgentSessionPaneKey(tabId, sessionId),
    messages: sessionContext.messages,
    fileLinkContext,
    inbox: inbox.button,
    tabId,
    groupId,
    sessionId,
    target,
    hasTerminalPaneActions: terminalPaneActions !== undefined
  })
  const focusSource = useCallback(() => composerRef.current?.focus(), [composerRef])
  const resolveOrcaSessionId = useMemo(
    () =>
      isOrcaSessionId(sessionId)
        ? () => resolveStructuredSessionOrcaSessionId(target, sessionId)
        : undefined,
    [sessionId, target]
  )
  const onSplit = useCallback(
    (shortcut: NativeChatPaneShortcut) => {
      if (terminalPaneActions) {
        return runNativeChatTerminalPaneShortcut(shortcut, terminalPaneActions)
      }
      // Tab groups have no equalize command; only terminal panes do.
      return groupId && shortcut !== 'equalize'
        ? runNativeChatSplitTarget(
            { kind: 'workspace-tab', unifiedTabId: tabId, groupId },
            shortcut
          )
        : false
    },
    [groupId, tabId, terminalPaneActions]
  )
  const menu: NativeChatSurfaceMenu = {
    rewind,
    // A chat in a terminal pane already hands off through that pane's own menu row.
    handOffDisabled: handOff.preparing || handOff.dialog !== null,
    onHandOff: terminalPaneActions === undefined && handOff.available ? handOff.open : undefined,
    actions: terminalPaneActions,
    sessionMenuItems: sessionMenuItems ?? sessionActions.menuItems,
    resolveOrcaSessionId,
    showTerminalPaneActions: terminalPaneActions !== undefined,
    chatSession:
      ownerWorktreeId && terminalPaneActions === undefined && isVisible
        ? {
            target,
            sessionId,
            worktreeId: ownerWorktreeId,
            agent: pane.agent,
            ...sessionContext,
            focusSource
          }
        : undefined,
    chatPane:
      ownerWorktreeId && groupId && terminalPaneActions === undefined
        ? { tabId, worktreeId: ownerWorktreeId, groupId, sessionId }
        : undefined
  }
  const commands = {
    header: sessionActions.header,
    titleActions: sessionActions.titleActions,
    headerDialog: sessionActions.dialog
  }
  return {
    menu,
    onSplit,
    paneHeader: (appearance) =>
      structuredChatPaneHeader(pane, ownerWorktreeId, appearance, commands, handOff)
  }
}
