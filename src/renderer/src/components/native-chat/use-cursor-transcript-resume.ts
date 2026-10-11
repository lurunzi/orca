import { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  isAiVaultScanCancelledError,
  isAiVaultSessionResumableContent,
  type AiVaultSession
} from '../../../../shared/ai-vault-types'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { getKnownExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { cursorSessionMatchesWorkspace } from '@/lib/cursor-transcript-tab'
import { isCursorTranscriptLive } from '@/lib/cursor-transcript-discovery-offers'
import { resolveAiVaultTargetWorkspacePath } from '../right-sidebar/ai-vault-session-launch-target'
import { useAiVaultSessionLaunchActions } from '../right-sidebar/ai-vault-session-launch-actions'

const RECHECK_MS = 60_000

/** Resolves a Cursor transcript tab to its Session History row so it can be resumed in
 *  Orca once the external worker stopped writing; a live worker stays read-only. */
export function useCursorTranscriptResume({
  worktreeId,
  sessionId,
  enabled
}: {
  worktreeId: string
  sessionId: string
  enabled: boolean
}): { resumable: boolean; resume: () => void } {
  const { path, hostId } = useAppStore(
    useShallow((state) => ({
      path: resolveAiVaultTargetWorkspacePath(state, worktreeId),
      hostId: getKnownExecutionHostIdForWorktree(state, worktreeId)
    }))
  )
  const targetState = useAppStore(
    useShallow((state) => ({
      projects: state.projects,
      settings: state.settings,
      folderWorkspaces: state.folderWorkspaces,
      projectGroups: state.projectGroups,
      repos: state.repos,
      worktreesByRepo: state.worktreesByRepo
    }))
  )
  const launchActions = useAiVaultSessionLaunchActions({
    activeWorktree: null,
    activeWorktreeId: worktreeId,
    targetState,
    agentCmdOverrides: targetState.settings?.agentCmdOverrides
  })
  const [found, setFound] = useState<{ session: AiVaultSession; checkedAt: number } | null>(null)

  useEffect(() => {
    const host = parseExecutionHostId(hostId)
    if (!enabled || !path || !host || host.kind === 'ssh') {
      return
    }
    let disposed = false
    const requestToken = createBrowserUuid()
    const check = async (): Promise<void> => {
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
        const session = result.sessions.find(
          (entry) =>
            entry.sessionId === sessionId && cursorSessionMatchesWorkspace(entry, path, host.id)
        )
        setFound(session ? { session, checkedAt: Date.now() } : null)
      } catch (error) {
        if (!disposed && !isAiVaultScanCancelledError(error)) {
          console.warn('[cursor-transcript] resume lookup failed', error)
        }
      }
    }
    void check()
    const timer = setInterval(() => void check(), RECHECK_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [enabled, hostId, path, sessionId])

  const resumable = Boolean(
    found &&
    !isCursorTranscriptLive(found.session, found.checkedAt) &&
    isAiVaultSessionResumableContent(found.session)
  )
  const { handleResume } = launchActions
  const resume = useCallback(() => {
    if (found) {
      handleResume(found.session, worktreeId)
    }
  }, [found, handleResume, worktreeId])
  return { resumable, resume }
}
