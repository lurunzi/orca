import type { AgentSessionModelCatalogResult } from '../../../../shared/agent-session/agent-session-wire'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { agentPickerModelFromCatalogModel } from '../../../../shared/agent-launch/picker/agent-launch-picker-catalog'
import { isTranscriptChatAgent } from '../../../../shared/transcript-chat-launch-view'
import { loadNativeChatCatalogModelsForWorktree } from '../native-chat/session/options/catalog/native-chat-session-option-discovery'

/** Fork: without a structured listing, Cursor and Antigravity still list the models their terminal chat discovers. */
export async function withTranscriptChatCatalogFallback(
  agent: TuiAgent,
  worktreeId: string | undefined,
  request: Promise<AgentSessionModelCatalogResult> | undefined
): Promise<AgentSessionModelCatalogResult | undefined> {
  if (!isTranscriptChatAgent(agent)) {
    return await request
  }
  const structured = await request?.catch(() => undefined)
  if (structured && structured.origin !== 'unknown') {
    return structured
  }
  const models = await loadNativeChatCatalogModelsForWorktree(agent, worktreeId ?? null).catch(
    () => null
  )
  return models?.length
    ? {
        origin: 'probe',
        models: models.map(agentPickerModelFromCatalogModel),
        fetchedAt: Date.now()
      }
    : structured
}
