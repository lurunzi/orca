import type { AiVaultSessionTitle } from '../../../../shared/ai-vault-session-title'
import type { Tab } from '../../../../shared/tab-types'

// Adapted from stablyai/orca#19941: structured chats keep their title on the unified tab.
export function applyAgentSessionAiVaultTitle(
  unifiedTabsByWorktree: Record<string, Tab[]>,
  tabId: string,
  aiVaultTitle: AiVaultSessionTitle | null
): Record<string, Tab[]> | null {
  for (const [worktreeId, tabs] of Object.entries(unifiedTabsByWorktree)) {
    const current = tabs.find((tab) => tab.contentType === 'agent-session' && tab.id === tabId)
    if (!current || (aiVaultTitle && current.agentSessionAgent !== aiVaultTitle.agent)) {
      continue
    }
    if (
      current.aiVaultTitle?.agent === aiVaultTitle?.agent &&
      current.aiVaultTitle?.sessionId === aiVaultTitle?.sessionId &&
      current.aiVaultTitle?.title === aiVaultTitle?.title
    ) {
      return null
    }
    return {
      ...unifiedTabsByWorktree,
      [worktreeId]: tabs.map((tab) => (tab === current ? { ...tab, aiVaultTitle } : tab))
    }
  }
  return null
}
