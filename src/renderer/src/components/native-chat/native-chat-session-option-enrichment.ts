import type { AgentType } from '../../../../shared/agent-status/contracts/agent-status-types'
import {
  AGENT_MODEL_CATALOG_FRESH_MS,
  AGENT_MODEL_CATALOG_FAILURE_TTL_MS
} from '../../../../shared/agent-model-catalog-refresh-policy'
import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session/options/agent-session-option-catalog'
import type { CatalogModel } from '../../../../shared/agent-session/options/agent-session-option-catalog-types'
import { mergeDiscoveredCatalogModels } from '../../../../shared/native-chat/input/native-chat-discovered-catalog-models'

type CatalogEnrichmentEntry = {
  state: 'idle' | 'pending' | 'settled'
  refreshAfter: number
  models: CatalogModel[] | null
  listeners: Set<(models: CatalogModel[]) => void>
  /** Settles when the running discovery does, success or not. */
  inflight?: Promise<void>
}

const enrichmentByAgentHost = new Map<string, CatalogEnrichmentEntry>()
export const NATIVE_CHAT_MODEL_ENRICHMENT_MAX_ENTRIES = 256

function retainEnrichmentEntry(key: string, entry: CatalogEnrichmentEntry): void {
  enrichmentByAgentHost.delete(key)
  enrichmentByAgentHost.set(key, entry)
  while (enrichmentByAgentHost.size > NATIVE_CHAT_MODEL_ENRICHMENT_MAX_ENTRIES) {
    const evictable = [...enrichmentByAgentHost].find(
      ([, candidate]) => candidate.listeners.size === 0 && candidate.state !== 'pending'
    )
    if (!evictable) {
      return
    }
    enrichmentByAgentHost.delete(evictable[0])
  }
}

function enrichmentKey(agent: AgentType, hostKey: string): string {
  return JSON.stringify([agent, hostKey])
}

export function readNativeChatEnrichedModels(
  agent: AgentType,
  hostKey: string
): CatalogModel[] | null {
  const models = enrichmentByAgentHost.get(enrichmentKey(agent, hostKey))?.models
  return models ? [...models] : null
}

export function subscribeNativeChatEnrichedModels(
  agent: AgentType,
  hostKey: string,
  listener: (models: CatalogModel[]) => void
): () => void {
  const key = enrichmentKey(agent, hostKey)
  const entry = enrichmentByAgentHost.get(key) ?? {
    state: 'idle' as const,
    refreshAfter: 0,
    models: null,
    listeners: new Set<(models: CatalogModel[]) => void>()
  }
  entry.listeners.add(listener)
  retainEnrichmentEntry(key, entry)
  return () => entry.listeners.delete(listener)
}

export function ensureNativeChatModelEnrichment(args: {
  agent: AgentType
  hostKey: string
  discover: () => Promise<readonly CatalogModel[] | null>
}): void {
  const catalog = getAgentSessionOptionCatalog(args.agent)
  if (!catalog?.listModels) {
    return
  }
  const key = enrichmentKey(args.agent, args.hostKey)
  const existing = enrichmentByAgentHost.get(key)
  if (existing?.state === 'pending' || (existing && Date.now() < existing.refreshAfter)) {
    return
  }
  const entry: CatalogEnrichmentEntry = existing ?? {
    state: 'idle',
    refreshAfter: 0,
    models: null,
    listeners: new Set()
  }
  entry.state = 'pending'
  retainEnrichmentEntry(key, entry)

  // Keep the last successful list usable while its execution host refreshes it.
  entry.inflight = args
    .discover()
    .then((discovered) => {
      entry.state = 'settled'
      entry.refreshAfter = Date.now() + AGENT_MODEL_CATALOG_FAILURE_TTL_MS
      retainEnrichmentEntry(key, entry)
      if (!discovered || discovered.length === 0) {
        return
      }
      entry.models = mergeDiscoveredCatalogModels(args.agent, catalog, discovered)
      entry.refreshAfter = Date.now() + AGENT_MODEL_CATALOG_FRESH_MS
      for (const listener of entry.listeners) {
        listener([...entry.models])
      }
    })
    .catch(() => {
      entry.state = 'settled'
      entry.refreshAfter = Date.now() + AGENT_MODEL_CATALOG_FAILURE_TTL_MS
      retainEnrichmentEntry(key, entry)
    })
}

/** The host's models, discovering when stale; null when no discovery has listed any. */
export async function loadNativeChatEnrichedModels(args: {
  agent: AgentType
  hostKey: string
  discover: () => Promise<readonly CatalogModel[] | null>
}): Promise<CatalogModel[] | null> {
  ensureNativeChatModelEnrichment(args)
  await enrichmentByAgentHost.get(enrichmentKey(args.agent, args.hostKey))?.inflight
  return readNativeChatEnrichedModels(args.agent, args.hostKey)
}

export function clearNativeChatModelEnrichmentForTests(): void {
  enrichmentByAgentHost.clear()
}

/** @internal - exposed for leak-regression tests only. */
export function getNativeChatModelEnrichmentEntryCountForTests(): number {
  return enrichmentByAgentHost.size
}
