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
    let reconciling = false
    const reconcile = (): void => {
      if (reconciling) {
        return
      }
      reconciling = true
      try {
        reconcileCursorTranscriptTabs(worktreeId)
      } finally {
        reconciling = false
      }
    }
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
    const discover = async (): Promise<void> => {
      if (disposed || inFlight || document.visibilityState === 'hidden') {
        return
      }
      inFlight = true
      try {
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
          .filter((entry) => cursorSessionMatchesWorkspace(entry, path, host.id))
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
      } catch (error) {
        if (!disposed && !isAiVaultScanCancelledError(error)) {
          console.warn('[cursor-transcript] discovery failed', error)
        }
      } finally {
        inFlight = false
      }
    }
    void discover()
    const timer = setInterval(() => void discover(), 60_000)
    const onVisible = (): void => {
      void discover()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      unsubscribe()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [hostId, path, ready, worktreeId])
  return null
}
