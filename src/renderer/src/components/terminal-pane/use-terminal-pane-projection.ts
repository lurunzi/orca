import { useCallback, useEffect } from 'react'
import type { CSSProperties } from 'react'
import {
  DEFAULT_TERMINAL_DIVIDER_DARK,
  isTerminalBackgroundLight,
  normalizeColor,
  resolveEffectiveTerminalAppearance,
  resolveOpaqueTerminalBackground
} from '@/lib/terminal-theme'
import { stripSshReconnectOwnedErrorLines } from './TerminalErrorToast'
import { mapPaneTerminalErrors, terminalErrorForPane } from './terminal-error-accumulation'
import {
  nativeChatLaunchAgentForLeaf,
  nativeChatLeafOwnsTabWideEvidence,
  resolveNativeChatLeafRoute
} from '../native-chat/native-chat-leaf-routing'
import { canContinueAgentSessionInNewSession } from './terminal-agent-session-continuation'
import type { TerminalPaneMobileController } from './use-terminal-pane-mobile-actions'
import { useAppStore } from '@/store'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { resolvePaneAgentSessionId } from './pane-agent-session-id'
import { useStructuredTuiOwnerReturn } from './use-structured-tui-owner-return'

export function useTerminalPaneProjection(controller: TerminalPaneMobileController) {
  const {
    applyNativeChatLeafRoute,
    canToggleChatForLeaf,
    chatLeafId,
    contextMenu,
    contextMenuLeafId,
    effectiveChatViewMode,
    getContextMenuLeafId,
    getNativeChatLeafIds,
    getTabWideAgentHintLeafId,
    isActive,
    isChatEligibleForLeaf,
    isChatViewMode,
    isVisible,
    managerRef,
    paneCount,
    toggleNativeChatForLeaf,
    paneTitles,
    paneTransportsRef,
    resolveTitleAgentForLeaf,
    setTerminalError,
    setTerminalErrorsByPaneId,
    settings,
    shouldMeasureHiddenStartup,
    tabId,
    sshReconnectOwnsTerminalErrors,
    systemPrefersDark,
    tabAgentTypeByLeaf,
    terminalError,
    terminalErrorsByPaneId,
    terminalTab,
    worktreeId
  } = controller
  const effectiveAppearance = settings
    ? resolveEffectiveTerminalAppearance(settings, systemPrefersDark)
    : null
  const terminalBackground =
    settings?.terminalColorOverrides?.background ?? effectiveAppearance?.theme?.background
  const titleUsesLightSurface = isTerminalBackgroundLight(terminalBackground, {
    appSurface: effectiveAppearance?.mode,
    backgroundOpacity: settings?.terminalBackgroundOpacity
  })
  const paneTitleBackground =
    resolveOpaqueTerminalBackground(terminalBackground, {
      appSurface: effectiveAppearance?.mode,
      backgroundOpacity: settings?.terminalBackgroundOpacity
    }) ?? (titleUsesLightSurface ? '#ffffff' : '#000000')
  const terminalContentVisible = isVisible || shouldMeasureHiddenStartup
  const hiddenStartupStyle: CSSProperties = shouldMeasureHiddenStartup
    ? { opacity: 0, pointerEvents: 'none' }
    : {}
  const terminalContainerStyle: CSSProperties = {
    display: terminalContentVisible ? 'flex' : 'none',
    overflow: 'hidden',
    ...hiddenStartupStyle,
    ['--orca-terminal-divider-color' as string]:
      effectiveAppearance?.dividerColor ?? DEFAULT_TERMINAL_DIVIDER_DARK,
    ['--orca-terminal-divider-color-strong' as string]: normalizeColor(
      effectiveAppearance?.dividerColor,
      DEFAULT_TERMINAL_DIVIDER_DARK
    )
  }
  const activePane = managerRef.current?.getActivePane()
  const managedPanes = managerRef.current?.getPanes() ?? []
  const showSshReconnectOverlay = isActive && isVisible && sshReconnectOwnsTerminalErrors
  // Why: SSH reconnect owns its failures even while this tab is hidden; clear only those lines so
  // unrelated pane errors survive and no stale connect failure flashes after recovery.
  useEffect(() => {
    if (!sshReconnectOwnsTerminalErrors) {
      return
    }
    setTerminalError((current) =>
      current === null ? null : stripSshReconnectOwnedErrorLines(current)
    )
    setTerminalErrorsByPaneId((current) =>
      mapPaneTerminalErrors(current, stripSshReconnectOwnedErrorLines)
    )
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Preserve the pre-split dependency contract.
  }, [sshReconnectOwnsTerminalErrors])
  const visibleTerminalError = terminalErrorForPane(
    terminalError,
    terminalErrorsByPaneId,
    activePane?.id ?? null
  )
  const menuPaneHasCustomTitle =
    contextMenu.menuPaneId !== null && Boolean(paneTitles[contextMenu.menuPaneId])
  const menuAgentSessionId = useAppStore((state) =>
    contextMenu.open && contextMenuLeafId
      ? resolvePaneAgentSessionId(state, makePaneKey(tabId, contextMenuLeafId))
      : null
  )
  const chatLeafStillMounted = chatLeafId
    ? managedPanes.some((pane) => pane.leafId === chatLeafId)
    : false
  useEffect(() => {
    const activeLeafId = activePane?.leafId ?? null
    applyNativeChatLeafRoute(
      resolveNativeChatLeafRoute({
        isChatViewMode,
        chatLeafId,
        activeLeafId,
        chatLeafStillMounted,
        activeLeafIsEligible: isChatEligibleForLeaf(activeLeafId)
      })
    )
  }, [
    isChatViewMode,
    chatLeafId,
    activePane?.leafId,
    chatLeafStillMounted,
    applyNativeChatLeafRoute,
    isChatEligibleForLeaf
  ])
  const chatPane =
    isChatViewMode && chatLeafId
      ? (managedPanes.find((pane) => pane.leafId === chatLeafId) ?? null)
      : null
  const chatPanePtyId = chatPane
    ? (paneTransportsRef.current.get(chatPane.id)?.getPtyId() ?? null)
    : null
  const chatPaneResolvedAgent = chatPane ? resolveTitleAgentForLeaf(chatPane.leafId) : null
  const chatPaneLaunchAgent = nativeChatLaunchAgentForLeaf({
    launchAgent: terminalTab?.launchAgent,
    launchAgentLeafId: getTabWideAgentHintLeafId(),
    leafId: chatPane?.leafId ?? null,
    leafIds: getNativeChatLeafIds()
  })
  const chatPaneOwnsTabWideLaunchDraft = nativeChatLeafOwnsTabWideEvidence({
    ownerLeafId: getTabWideAgentHintLeafId(),
    leafId: chatPane?.leafId ?? null,
    leafIds: getNativeChatLeafIds()
  })
  const activePaneIsChatLeaf = Boolean(
    isChatViewMode && activePane?.leafId && activePane.leafId === chatLeafId
  )
  const resolveAgentForLeaf = (leafId: string | null): string | null => {
    const detectedAgent = leafId ? (tabAgentTypeByLeaf[leafId] ?? null) : null
    if (detectedAgent) {
      return detectedAgent
    }
    return (
      nativeChatLaunchAgentForLeaf({
        launchAgent: terminalTab?.launchAgent,
        launchAgentLeafId: getTabWideAgentHintLeafId(),
        leafId,
        leafIds: getNativeChatLeafIds()
      }) ?? resolveTitleAgentForLeaf(leafId)
    )
  }
  const activePaneCanContinueInNewSession = canContinueAgentSessionInNewSession(
    resolveAgentForLeaf(activePane?.leafId ?? null)
  )
  const contextMenuCanContinueInNewSession = canContinueAgentSessionInNewSession(
    resolveAgentForLeaf(contextMenuLeafId)
  )
  const structuredTuiOwner = useStructuredTuiOwnerReturn({
    worktreeId,
    tabId,
    enabled: isActive && isVisible,
    paneCount,
    managerRef,
    paneTransportsRef
  })
  const contextMenuIsChatView = effectiveChatViewMode && contextMenuLeafId === chatLeafId
  // A structured session's owning terminal switches back to that session's Chat, not to a transcript chat.
  const activePaneReturnsToStructuredChat =
    !activePaneIsChatLeaf && structuredTuiOwner.ownsLeaf(activePane?.leafId ?? null)
  const contextMenuReturnsToStructuredChat =
    !contextMenuIsChatView && structuredTuiOwner.ownsLeaf(contextMenuLeafId)
  // Each switcher gates on its own leaf (header=active, menu=opened-over), so mixed splits show it only where chat can render.
  const activePaneCanToggleChat =
    activePaneReturnsToStructuredChat || canToggleChatForLeaf(activePane?.leafId ?? null)
  const contextMenuCanToggleChat =
    contextMenuReturnsToStructuredChat || canToggleChatForLeaf(contextMenuLeafId)
  const { ownsLeaf: structuredTuiOwnsLeaf, returnLeafToChat } = structuredTuiOwner
  const toggleChatOrReturnForLeaf = useCallback(
    (leafId: string, isChatLeaf: boolean) => {
      if (isChatLeaf || !structuredTuiOwnsLeaf(leafId)) {
        toggleNativeChatForLeaf(leafId)
        return
      }
      void returnLeafToChat(leafId).then((returned) => {
        if (!returned) {
          toggleNativeChatForLeaf(leafId)
        }
      })
    },
    [returnLeafToChat, structuredTuiOwnsLeaf, toggleNativeChatForLeaf]
  )
  const handleContextMenuToggleNativeChat = useCallback(() => {
    const leafId = getContextMenuLeafId()
    if (!leafId) {
      return
    }
    toggleChatOrReturnForLeaf(leafId, effectiveChatViewMode && leafId === chatLeafId)
  }, [chatLeafId, effectiveChatViewMode, getContextMenuLeafId, toggleChatOrReturnForLeaf])
  const handlePaneHeaderToggleNativeChat = useCallback(() => {
    const leafId = managerRef.current?.getActivePane()?.leafId ?? null
    if (!leafId) {
      return
    }
    toggleChatOrReturnForLeaf(leafId, isChatViewMode && leafId === chatLeafId)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- managerRef is a stable ref container.
  }, [chatLeafId, isChatViewMode, toggleChatOrReturnForLeaf])
  return {
    effectiveAppearance,
    terminalBackground,
    titleUsesLightSurface,
    paneTitleBackground,
    terminalContentVisible,
    hiddenStartupStyle,
    terminalContainerStyle,
    activePane,
    managedPanes,
    showSshReconnectOverlay,
    visibleTerminalError,
    menuPaneHasCustomTitle,
    menuAgentSessionId,
    chatLeafStillMounted,
    chatPane,
    chatPanePtyId,
    chatPaneResolvedAgent,
    chatPaneLaunchAgent,
    chatPaneOwnsTabWideLaunchDraft,
    activePaneIsChatLeaf,
    resolveAgentForLeaf,
    activePaneCanContinueInNewSession,
    contextMenuCanContinueInNewSession,
    activePaneCanToggleChat,
    contextMenuCanToggleChat,
    contextMenuIsChatView,
    activePaneReturnsToStructuredChat,
    contextMenuReturnsToStructuredChat,
    handleContextMenuToggleNativeChat,
    handlePaneHeaderToggleNativeChat
  }
}

export type TerminalPaneProjectionController = TerminalPaneMobileController &
  ReturnType<typeof useTerminalPaneProjection>
