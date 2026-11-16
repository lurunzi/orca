import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { getKnownExecutionHostIdForWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner'
import { createNonSecureContextUuid as createBrowserUuid } from '../../../../shared/non-secure-context-uuid'
import { resolveAiVaultTargetWorkspacePath } from '../right-sidebar/ai-vault/session-actions/ai-vault-session-launch-target'
import {
  cursorSessionMatchesWorkspace,
  openCursorTranscriptTab,
  reconcileCursorTranscriptTabs
} from '@/lib/cursor-transcript-tab'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { isAiVaultScanCancelledError } from '../../../../shared/ai-vault/contracts/ai-vault-types'
import {
  cursorTranscriptOfferKey,
  isCursorTranscriptRecent,
  recordCursorTranscriptOffer,
  wasCursorTranscriptOffered
} from '@/lib/cursor-transcript-discovery-offers'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'

// React Compiler cannot compile try/finally inside a component.
function reconcileUnlessReentered(guard: { reconciling: boolean }, worktreeId: string): void {
  if (guard.reconciling) {
    return
  }
  guard.reconciling = true
  try {
    reconcileCursorTranscriptTabs(worktreeId)
  } finally {
    guard.reconciling = false
  }
}

/** Discover external workers through the shared history scanner, without fabricating hook status. */
export function CursorTranscriptDiscoveryGate(): null {
  const { worktreeId, path, hostId, ready } = useAppStore(
    useShallow((state) => ({
      worktreeId: state.activeWorktreeId,
      path: state.activeWorktreeId
        ? resolveAiVaultTargetWorkspacePath(state, state.activeWorktreeId)
        : null,
      hostId: getKnownExecutionHostIdForWorktree(state, state.activeWorktreeId),
      ready: state.workspaceSessionReady
    }))
  )
  useEffect(() => {
    const host = parseExecutionHostId(hostId)
    if (!ready || !worktreeId || !path || !host || host.kind === 'ssh') {
      return
    }
    let disposed = false
    let inFlight = false
    const reconcileGuard = { reconciling: false }
    const reconcile = (): void => reconcileUnlessReentered(reconcileGuard, worktreeId)
    reconcile()
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (
        state.agentStatusByPaneKey !== previous.agentStatusByPaneKey ||
        state.unifiedTabsByWorktree !== previous.unifiedTabsByWorktree ||
        state.terminalLayoutsByTabId !== previous.terminalLayoutsByTabId ||
        state.sleepingAgentSessionsByPaneKey !== previous.sleepingAgentSessionsByPaneKey
      ) {
        reconcile()
      }
    })
    const requestToken = createBrowserUuid()
    const offerRecentTranscript = async (): Promise<void> => {
      reconcile()
      const result = await window.api.aiVault.listSessions({
        limit: 100,
        scopePaths: [path],
        executionHostScope: host.id,
        requestToken
      })
      if (disposed || result.cancelled) {
        return
      }
      const session = result.sessions
        // Structured chats (e.g. orchestration workers) already have their own tab.
        .filter(
          (entry) => !entry.structuredSession && cursorSessionMatchesWorkspace(entry, path, host.id)
        )
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))[0]
      // Older conversations remain available in History.
      if (!session || !isCursorTranscriptRecent(session)) {
        return
      }
      const key = cursorTranscriptOfferKey(host.id, worktreeId, session.sessionId)
      if (wasCursorTranscriptOffered(key)) {
        return
      }
      const state = useAppStore.getState()
      const panePrefixes = (state.unifiedTabsByWorktree[worktreeId] ?? [])
        .filter((tab) => tab.contentType === 'terminal')
        .map((tab) => `${tab.entityId}:`)
      const represented = Object.entries(state.agentStatusByPaneKey).some(
        ([paneKey, entry]) =>
          panePrefixes.some((prefix) => paneKey.startsWith(prefix)) &&
          entry.providerSession?.id === session.sessionId
      )
      if (!represented && openCursorTranscriptTab(session, worktreeId, false)) {
        // A user-closed tab stays closed until explicitly reopened from History.
        recordCursorTranscriptOffer(key)
      }
    }
    const discover = async (): Promise<void> => {
      if (disposed || inFlight || document.visibilityState === 'hidden') {
        return
      }
      inFlight = true
      try {
        await offerRecentTranscript()
      } catch (error) {
        if (!disposed && !isAiVaultScanCancelledError(error)) {
          console.warn('[cursor-transcript] discovery failed', error)
        }
      }
      inFlight = false
    }
    const stopPolling = installWindowVisibilityInterval({
      run: () => void discover(),
      intervalMs: 60_000
    })
    return () => {
      disposed = true
      unsubscribe()
      stopPolling()
    }
  }, [hostId, path, ready, worktreeId])
  return null
}
