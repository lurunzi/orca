import type { AiVaultSession } from '../../../shared/ai-vault-types'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import { parseExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'
import { useAppStore } from '@/store'
import { getKnownExecutionHostIdForWorktree } from './worktree-runtime-owner'
import { resolveAiVaultTargetWorkspacePath } from '@/components/right-sidebar/ai-vault-session-launch-target'

export function cursorSessionMatchesWorkspace(
  session: AiVaultSession,
  path: string,
  host: ExecutionHostId
): boolean {
  return (
    session.agent === 'cursor' &&
    Boolean(session.sessionId && session.filePath && session.cwd) &&
    session.executionHostId === host &&
    normalizeRuntimePathForComparison(session.cwd ?? '') === normalizeRuntimePathForComparison(path)
  )
}

/** Opens a transcript reader; it never acquires or resumes the provider's worker. */
export function openCursorTranscriptTab(
  session: AiVaultSession,
  worktreeId: string,
  activate = true
): boolean {
  const state = useAppStore.getState()
  const path = resolveAiVaultTargetWorkspacePath(state, worktreeId)
  const hostId = getKnownExecutionHostIdForWorktree(state, worktreeId)
  const host = parseExecutionHostId(hostId)
  // Direct SSH has no transcript read transport; never fall back to the local disk.
  if (
    !path ||
    !host ||
    host.kind === 'ssh' ||
    !cursorSessionMatchesWorkspace(session, path, host.id)
  ) {
    return false
  }
  const entityId = `cursor-transcript:${host.id}:${session.sessionId}`
  const existing = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
    (tab) => tab.agentTranscript && tab.entityId === entityId
  )
  if (existing) {
    if (activate) {
      state.focusGroup(worktreeId, existing.groupId)
      state.activateTab(existing.id, { worktreeId })
    }
    return true
  }
  state.createUnifiedTab(worktreeId, 'agent-session', {
    entityId,
    executionHostId: host.id,
    agentSessionAgent: 'cursor',
    label: `Cursor · ${session.title || session.sessionId}`,
    agentTranscript: {
      agent: 'cursor',
      sessionId: session.sessionId,
      transcriptPath: session.filePath,
      runtimeEnvironmentId: host.kind === 'runtime' ? host.environmentId : null
    },
    activate,
    recordInteraction: activate
  })
  return true
}
