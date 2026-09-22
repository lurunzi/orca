import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { getKnownExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { resolveAiVaultTargetWorkspacePath } from '../right-sidebar/ai-vault-session-launch-target'
import { cursorSessionMatchesWorkspace, openCursorTranscriptTab } from '@/lib/cursor-transcript-tab'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { isAiVaultScanCancelledError } from '../../../../shared/ai-vault-types'

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
  const offered = useRef(new Set<string>())
  useEffect(() => {
    const host = parseExecutionHostId(hostId)
    if (!ready || !worktreeId || !path || !host || host.kind === 'ssh') {
      return
    }
    let disposed = false
    let inFlight = false
    const requestToken = crypto.randomUUID()
    const discover = async (): Promise<void> => {
      if (disposed || inFlight || document.visibilityState === 'hidden') {
        return
      }
      inFlight = true
      try {
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
        if (!session) {
          return
        }
        const key = JSON.stringify([host.id, worktreeId, session.sessionId])
        if (offered.current.has(key)) {
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
          offered.current.add(key)
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
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [hostId, path, ready, worktreeId])
  return null
}
