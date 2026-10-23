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
import { prepareAiVaultSessionForTerminalResume } from '@/lib/ai-vault-session-resume-preparation'
import { buildAiVaultResumeStartupForWorktree } from '@/lib/ai-vault-resume-command'
import { launchAiVaultSessionInNewTab } from '@/lib/launch-ai-vault-session'
import { pasteAgentLaunchPromptOnceReady } from '@/lib/launch-agent-tab-prompt-paste'
import { findCursorTranscriptTerminal } from '@/lib/cursor-transcript-terminal'
import { translate } from '@/i18n/i18n'
import { resolveAiVaultTargetWorkspacePath } from '../right-sidebar/ai-vault-session-launch-target'

const RECHECK_MS = 60_000

/** Resolve the exact history row; transcript freshness is not process liveness. */
export function useCursorTranscriptResume({
  worktreeId,
  sessionId,
  enabled
}: {
  worktreeId: string
  sessionId: string
  enabled: boolean
}): { resumable: boolean; resume: (prompt: string) => Promise<boolean> } {
  const { path, hostId } = useAppStore(
    useShallow((state) => ({
      path: resolveAiVaultTargetWorkspacePath(state, worktreeId),
      hostId: getKnownExecutionHostIdForWorktree(state, worktreeId)
    }))
  )
  const [found, setFound] = useState<AiVaultSession | null>(null)

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
        setFound(session ?? null)
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
    path &&
    hostId &&
    found.sessionId === sessionId &&
    cursorSessionMatchesWorkspace(found, path, hostId) &&
    isAiVaultSessionResumableContent(found)
  )
  const resume = useCallback(
    async (prompt: string): Promise<boolean> => {
      if (!resumable || !found) {
        return false
      }
      const state = useAppStore.getState()
      if (
        getKnownExecutionHostIdForWorktree(state, worktreeId) !== hostId ||
        resolveAiVaultTargetWorkspacePath(state, worktreeId) !== path
      ) {
        return false
      }
      let terminal = findCursorTranscriptTerminal(state, worktreeId, sessionId)
      let tabId = terminal?.tabId
      if (!tabId) {
        const session = await prepareAiVaultSessionForTerminalResume(found)
        const current = useAppStore.getState()
        if (
          getKnownExecutionHostIdForWorktree(current, worktreeId) !== hostId ||
          resolveAiVaultTargetWorkspacePath(current, worktreeId) !== path
        ) {
          return false
        }
        terminal = findCursorTranscriptTerminal(current, worktreeId, sessionId)
        tabId = terminal?.tabId
        if (!tabId) {
          const startup = buildAiVaultResumeStartupForWorktree({
            state: current,
            worktreeId,
            session,
            commandOverride: current.settings?.agentCmdOverrides?.cursor
          })
          const launch = launchAiVaultSessionInNewTab({ agent: 'cursor', worktreeId, ...startup })
          if (launch.tabId !== null) {
            tabId = launch.tabId
          } else {
            const outcome = await launch.runtimeLaunch
            if (outcome.status === 'failed') {
              throw new Error(outcome.message)
            }
            tabId = findCursorTranscriptTerminal(
              useAppStore.getState(),
              worktreeId,
              sessionId
            )?.tabId
          }
        }
      }
      if (!tabId || (terminal && !terminal.ptyId)) {
        throw new Error(
          translate(
            'components.native-chat.cursorTranscript.terminalUnavailable',
            'The resumed terminal is not available yet. Your draft has been kept.'
          )
        )
      }
      const owner = useAppStore.getState()
      const unified = owner.unifiedTabsByWorktree[worktreeId]?.find(
        (tab) => tab.contentType === 'terminal' && tab.entityId === tabId
      )
      if (unified) {
        owner.setTabViewMode(unified.id, 'chat')
      }
      const result = await pasteAgentLaunchPromptOnceReady({
        worktreeId,
        tabId,
        agent: 'cursor',
        content: prompt,
        prompt,
        submit: true,
        ...(terminal?.ptyId ? { launchPty: Promise.resolve(terminal.ptyId) } : {})
      })
      if (!result.delivered) {
        throw new Error(
          translate(
            'components.native-chat.cursorTranscript.deliveryUnconfirmed',
            'Message delivery was not confirmed. Your draft has been kept.'
          )
        )
      }
      return true
    },
    [found, hostId, path, resumable, sessionId, worktreeId]
  )
  return { resumable, resume }
}
