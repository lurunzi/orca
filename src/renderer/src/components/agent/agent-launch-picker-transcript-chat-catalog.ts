import type { AgentSessionModelCatalogResult } from '../../../../shared/agent-session/agent-session-wire'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { agentPickerModelFromCatalogModel } from '../../../../shared/agent-launch/picker/agent-launch-picker-catalog'
import { isTranscriptChatAgent } from '../../../../shared/transcript-chat-launch-view'
import { loadNativeChatCatalogModelsForWorktree } from '../native-chat/session/options/catalog/native-chat-session-option-discovery'
import type { RuntimeGitContext } from '@/runtime/source-control/git/runtime-git-client-context'
import { agentPickerListsCliModels } from './agent-launch-picker-cli-model-catalog'
import type { AgentPickerEntry } from '../../../../shared/agent-launch/picker/agent-launch-picker'

/** Fork: without a structured listing, Cursor and Antigravity still list the models their terminal chat discovers. */
export async function withTranscriptChatCatalogFallback(
  agent: TuiAgent,
  worktreeId: string | undefined,
  request: Promise<AgentSessionModelCatalogResult | undefined> | undefined
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

type CatalogRead = (
  entry: AgentPickerEntry,
  waitForListing: boolean,
  signal: AbortSignal,
  relist?: boolean
) => Promise<AgentSessionModelCatalogResult | undefined>

/** Fork: entries carry their picker's worktree, so the fallback reads the same workspace. */
export function withTranscriptChatCatalogReads<Reads extends { catalog: CatalogRead }>(
  cliDiscoveryRuntime: RuntimeGitContext | null | undefined,
  reads: Reads
): Omit<Reads, 'catalog'> & { catalog: CatalogRead } {
  const read = reads.catalog
  return {
    ...reads,
    catalog: (entry, waitForListing, signal, relist) =>
      cliDiscoveryRuntime && agentPickerListsCliModels(entry)
        ? read(entry, waitForListing, signal, relist)
        : withTranscriptChatCatalogFallback(
            entry.agent,
            entry.worktreeId,
            read(entry, waitForListing, signal, relist)
          )
  }
}
