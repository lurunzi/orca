import type { AiVaultSession } from '../../../shared/ai-vault/contracts/ai-vault-types'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import { parseExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { getKnownExecutionHostIdForWorktree } from './workspace/ownership/worktree-runtime-owner'
import { resolveAiVaultTargetWorkspacePath } from '@/components/right-sidebar/ai-vault/session-actions/ai-vault-session-launch-target'
import { findCursorTranscriptTerminal } from './cursor-transcript-terminal'
import { nativeChatComposerHasUserContent } from '@/components/native-chat/native-chat-pending-attachment-cache'
import { readNativeChatComposerDraft } from '@/components/native-chat/native-chat-composer-draft-store'

function cursorTerminalTab(worktreeId: string, sessionId: string) {
  const state = useAppStore.getState()
  const terminal = findCursorTranscriptTerminal(state, worktreeId, sessionId)
  const tab =
    terminal &&
    (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (entry) => entry.contentType === 'terminal' && entry.entityId === terminal.tabId
    )
  return terminal && tab ? { terminal, tab } : null
}

function activateCursorTerminal(
  worktreeId: string,
  owner: NonNullable<ReturnType<typeof cursorTerminalTab>>
): void {
  const state = useAppStore.getState()
  const layout = state.terminalLayoutsByTabId[owner.terminal.tabId]
  const leafId = owner.terminal.paneKey.slice(owner.terminal.tabId.length + 1)
  if (layout) {
    state.setTabLayout(owner.terminal.tabId, {
      ...layout,
      activeLeafId: leafId,
      chatLeafId: leafId
    })
  }
  state.setTabViewMode(owner.tab.id, 'chat')
  state.focusGroup(worktreeId, owner.tab.groupId)
  state.activateTab(owner.tab.id, { worktreeId, recordFocus: false })
}

/** Late hook identity may arrive after discovery opened a transcript reader. */
export function reconcileCursorTranscriptTabs(worktreeId: string): void {
  const state = useAppStore.getState()
  const host = getKnownExecutionHostIdForWorktree(state, worktreeId)
  for (const tab of state.unifiedTabsByWorktree[worktreeId] ?? []) {
    const source = tab.agentTranscript
    if (
      !source ||
      host !== (source.runtimeEnvironmentId ? `runtime:${source.runtimeEnvironmentId}` : 'local') ||
      readNativeChatComposerDraft(tab.id).text !== '' ||
      nativeChatComposerHasUserContent(tab.id)
    ) {
      continue
    }
    const owner = cursorTerminalTab(worktreeId, source.sessionId)
    if (!owner) {
      continue
    }
    if (state.activeWorktreeId === worktreeId && state.getActiveTab(worktreeId)?.id === tab.id) {
      activateCursorTerminal(worktreeId, owner)
    }
    useAppStore
      .getState()
      .closeUnifiedTab(tab.id, { preserveWorktreeSelection: true, recordInteraction: false })
  }
}

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
  const owner = cursorTerminalTab(worktreeId, session.sessionId)
  if (owner && (!existing || !nativeChatComposerHasUserContent(existing.id))) {
    if (activate) {
      activateCursorTerminal(worktreeId, owner)
    }
    reconcileCursorTranscriptTabs(worktreeId)
    return true
  }
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
    label: translate('auto.lib.cursor.transcript.tab.label', 'Cursor · {{title}}', {
      title: session.title || session.sessionId
    }),
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
