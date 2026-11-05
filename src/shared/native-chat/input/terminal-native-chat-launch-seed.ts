import { resolveAgentChoiceLayers } from '../../agent-choice-layers'
import type { AgentDedicatedChoices } from '../../agent-launch-choices'
import {
  findCatalogModel,
  getAgentSessionOptionLaunchCatalog
} from '../../agent-session/options/agent-session-option-catalog'
import type { GlobalSettings } from '../../global-settings-types'
import { isTuiAgent } from '../../tui-agent-config'
import type { TuiAgent } from '../../tui-agent'
import { resolveNativeChatSessionOptionDefaults } from './native-chat-session-option-defaults'
import { decodeCatalogOptionValue } from '../../agent-session/options/structured-agent-session-option-codec'
import type { SessionOptionValue } from './native-chat-session-options'

export function rememberedNativeChatModelStillListed(args: {
  agent: TuiAgent
  modelId: string
  discoveredModelIds?: readonly string[] | null
}): boolean {
  const catalog = getAgentSessionOptionLaunchCatalog(args.agent)
  if (!catalog?.modelApply.launchArgs) {
    return false
  }
  const { modelId, discoveredModelIds } = args
  if (discoveredModelIds?.length) {
    return discoveredModelIds.includes(modelId)
  }
  if (catalog.discoveredModelsAreAuthoritative) {
    return false
  }
  return findCatalogModel(catalog, modelId) !== undefined || catalog.listModels !== undefined
}

export function rememberedNativeChatLaunchChoices(
  settings:
    | Pick<GlobalSettings, 'nativeChatSessionOptions' | 'agentLaunchChoices'>
    | null
    | undefined,
  agent: TuiAgent,
  discoveredModelIds?: readonly string[] | null
): AgentDedicatedChoices | undefined {
  if (!isTuiAgent(agent)) {
    return undefined
  }
  const catalog = getAgentSessionOptionLaunchCatalog(agent)
  if (!catalog?.modelApply.launchArgs) {
    return undefined
  }
  const persisted = resolveNativeChatSessionOptionDefaults(
    settings?.nativeChatSessionOptions,
    agent
  )
  const modelId = typeof persisted?.model === 'string' ? persisted.model : undefined
  if (!modelId || !rememberedNativeChatModelStillListed({ agent, modelId, discoveredModelIds })) {
    return undefined
  }
  const { model, ...options } = persisted
  const rememberedOptions = Object.fromEntries(
    Object.entries(options).map(([id, value]) => [
      id,
      typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)
    ])
  )
  const choices = resolveAgentChoiceLayers({
    agent,
    argumentOwner: 'defaults',
    defaults: settings?.agentLaunchChoices?.[agent],
    remembered: { model, options: rememberedOptions }
  })
  return choices.model || Object.keys(choices.options ?? {}).length > 0 ? choices : undefined
}

export function rememberedNativeChatLaunchSessionOptions(
  settings:
    | Pick<GlobalSettings, 'nativeChatSessionOptions' | 'agentLaunchChoices'>
    | null
    | undefined,
  agent: TuiAgent,
  discoveredModelIds?: readonly string[] | null
): Record<string, SessionOptionValue> | undefined {
  const choices = rememberedNativeChatLaunchChoices(settings, agent, discoveredModelIds)
  if (!choices) {
    return undefined
  }
  const catalog = getAgentSessionOptionLaunchCatalog(agent)
  const modelEntry = choices.model ? findCatalogModel(catalog!, choices.model) : undefined
  const sessionOptions: Record<string, SessionOptionValue> = {}
  if (choices.model) {
    sessionOptions.model = choices.model
  }
  for (const [id, encoded] of Object.entries(choices.options ?? {})) {
    const option = modelEntry?.options.find((entry) => entry.id === id)
    sessionOptions[id] =
      (option ? decodeCatalogOptionValue(option.kind, encoded) : undefined) ?? encoded
  }
  return Object.keys(sessionOptions).length > 0 ? sessionOptions : undefined
}
