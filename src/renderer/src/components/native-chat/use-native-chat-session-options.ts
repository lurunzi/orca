import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import {
  getAgentSessionOptionCatalog,
  type CatalogModel
} from '../../../../shared/agent-session-option-catalog'
import { matchNativeChatCatalogModelId } from '../../../../shared/native-chat-session-option-state'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import { useAppStore } from '../../store'
import {
  createNativeChatPtySessionOptions,
  type NativeChatPtySessionOptionsSurface
} from './native-chat-pty-session-options'
import type { NativeChatSessionOptionDispatchCommand } from './native-chat-session-option-command-dispatch'
import {
  ensureNativeChatModelEnrichment,
  readNativeChatEnrichedModels,
  subscribeNativeChatEnrichedModels
} from './native-chat-session-option-enrichment'
import {
  discoverNativeChatCatalogModels,
  resolveNativeChatModelDiscoveryContext
} from './native-chat-session-option-discovery'
import { readAgentTerminalSessionOptions } from './agent-terminal-session-options'

import { enqueueSessionOptionSettingsWrite } from './native-chat-session-option-settings-write'

const EMPTY_SNAPSHOT: SessionOptionDescriptor[] = []
const subscribeEmpty = (): (() => void) => () => {}
const getEmptySnapshot = (): SessionOptionDescriptor[] => EMPTY_SNAPSHOT

const CLIENT_SETTINGS_TARGET = { kind: 'local' } as const

/**
 * Why: the picker drops a retired model, but the persisted default is what launches
 * become `-m <id>` — every launch site reads it, including the ones that never show
 * the picker. Left alone the id is invisible and still fatal, so an authoritative
 * probe that no longer lists it must retire it here too.
 */
export async function retirePersistedModelMissingFromDiscovery(
  agent: AgentType,
  models: readonly CatalogModel[]
): Promise<void> {
  if (!getAgentSessionOptionCatalog(agent)?.discoveredModelsAreAuthoritative) {
    return
  }
  // An empty list means the probe failed, not that the account has no models.
  if (models.length === 0) {
    return
  }
  await enqueueSessionOptionSettingsWrite(CLIENT_SETTINGS_TARGET, {
    type: 'clear-model-if-missing',
    agent,
    availableModelIds: models.map((model) => model.id)
  })
}

export function useNativeChatSessionOptions(args: {
  agent: AgentType
  terminalTabId: string
  targetPtyId: string | null
  dispatchCommand: NativeChatSessionOptionDispatchCommand
  onAgentPicker?: () => void
  readTerminalScreen?: () => string | null
  /** Pane whose live agent status names the provider model, for agents whose hook
   *  reports one (OMP). Claude's model comes from its terminal frame instead. */
  paneKey?: string
}): {
  surface: NativeChatPtySessionOptionsSurface | null
  snapshot: SessionOptionDescriptor[]
} {
  const {
    agent,
    terminalTabId,
    targetPtyId,
    dispatchCommand,
    onAgentPicker,
    readTerminalScreen,
    paneKey
  } = args
  // Why: a primitive selector, so unrelated status pings on the pane rerender nothing.
  const reportedModel = useAppStore((state) =>
    paneKey ? (state.agentStatusByPaneKey[paneKey]?.model ?? null) : null
  )
  const canSwitchOmpModel = useAppStore((state) =>
    paneKey ? state.agentStatusByPaneKey[paneKey]?.modelSwitchCommand === 'orca-model' : false
  )
  // The hook-reported model this surface last applied. Only a report that CHANGES
  // is evidence: the same value is re-delivered on every status ping, and a
  // session-start report cannot have observed a `/model` picked after it.
  const appliedReportedModelRef = useRef<string | null>(null)
  // The screen text that last parsed into reported values, so a later model
  // discovery can re-resolve it against the host's real ids.
  const reportedScreenRef = useRef<string | null>(null)
  const discoveryContext = useMemo(
    () => resolveNativeChatModelDiscoveryContext(terminalTabId),
    [terminalTabId]
  )
  const surface = useMemo(() => {
    // Why: native chat currently attaches only after startup is already queued;
    // exposing a draft picker here would claim it can still mutate that command.
    if (!targetPtyId) {
      return null
    }
    const scopeKey = targetPtyId ?? terminalTabId
    const discoveredModels = discoveryContext
      ? readNativeChatEnrichedModels(agent, discoveryContext.hostKey)
      : null
    const reportedValues =
      agent === 'claude' || agent === 'antigravity'
        ? readAgentTerminalSessionOptions(
            agent,
            readTerminalScreen?.(),
            discoveredModels ?? undefined
          )
        : null
    return createNativeChatPtySessionOptions({
      agent,
      scopeKey,
      ...(targetPtyId ? { fallbackScopeKey: terminalTabId } : {}),
      // Why: the catalog seed carries version-neutral family labels, so it is
      // safe on every host while the once-per-host probe runs or after it fails
      // — without it the whole picker would pop in late or never appear.
      ...(discoveryContext ? { initialModels: discoveredModels ?? undefined } : {}),
      mode: targetPtyId ? 'live' : 'draft',
      reportedValues,
      dispatchCommand,
      canSwitchOmpModel,
      onAgentPicker,
      persistSelection: ({ modelId, optionId, value, adoptModelAsLaunchDefault }) =>
        // Paired PTY launches still assemble their launch preferences from client settings.
        enqueueSessionOptionSettingsWrite(CLIENT_SETTINGS_TARGET, {
          type: 'apply-picks',
          agent,
          picks: [{ modelId, optionId, value, adoptModelAsLaunchDefault }]
        })
    })
  }, [
    agent,
    canSwitchOmpModel,
    dispatchCommand,
    discoveryContext,
    onAgentPicker,
    readTerminalScreen,
    targetPtyId,
    terminalTabId
  ])

  useEffect(() => {
    if (!surface || (agent !== 'claude' && agent !== 'antigravity')) {
      return
    }
    reportedScreenRef.current = null
    const current = surface.getSnapshot().find((option) => option.id === 'model')
    if (current?.valueSource === 'applied' || current?.valueSource === 'dispatched') {
      return
    }
    let cancelled = false
    let attempts = 0
    let found = false
    let reading = false
    const reportScreen = (screen: string | null): boolean => {
      const models = discoveryContext
        ? readNativeChatEnrichedModels(agent, discoveryContext.hostKey)
        : null
      const reportedValues = readAgentTerminalSessionOptions(agent, screen, models ?? undefined)
      if (!reportedValues || cancelled) {
        return false
      }
      found = true
      const current = surface.getSnapshot().find((option) => option.id === 'model')
      // Startup chrome cannot confirm or undo a later model pick.
      if (current?.valueSource === 'applied' || current?.valueSource === 'dispatched') {
        return true
      }
      // Discovery may arrive after the startup frame has scrolled away.
      reportedScreenRef.current = screen
      surface.reportSessionOptions(reportedValues)
      return true
    }
    const reportCurrentValues = async (): Promise<void> => {
      if (cancelled || found) {
        return
      }
      // Preserve a visible startup frame before it scrolls away while the host read is pending.
      if (reportScreen(readTerminalScreen?.() ?? null)) {
        return
      }
      if (reading) {
        return
      }
      reading = true
      let authoritativeScreen: string | null = null
      if (targetPtyId && window.api?.pty?.getMainBufferSnapshot) {
        try {
          const snapshot = await window.api.pty.getMainBufferSnapshot(targetPtyId, {
            scrollbackRows: 0
          })
          // Why: the API snapshots the main buffer, which is stale while a TUI
          // owns the alternate screen. The mounted xterm is authoritative then.
          authoritativeScreen = snapshot?.alternateScreen ? null : (snapshot?.data ?? null)
        } catch {
          // The mounted renderer buffer remains a transport-neutral fallback.
        }
      }
      if (cancelled || found) {
        return
      }
      for (const screen of [authoritativeScreen, readTerminalScreen?.() ?? null]) {
        if (reportScreen(screen)) {
          return
        }
      }
      reading = false
    }
    void reportCurrentValues()
    const retry = window.setInterval(() => {
      if (found || ++attempts >= 60) {
        window.clearInterval(retry)
      } else {
        void reportCurrentValues()
      }
    }, 1_000)
    return () => {
      cancelled = true
      window.clearInterval(retry)
    }
  }, [agent, discoveryContext, readTerminalScreen, surface, targetPtyId])

  // Why: keyed on the scope, not the surface — the record survives a surface rebuild
  // for the same pty, so re-applying the same report there would revert a user's pick.
  useEffect(() => {
    appliedReportedModelRef.current = null
  }, [agent, targetPtyId, terminalTabId])

  useEffect(() => {
    // Why: Claude's model is read off its terminal frame above; the hook path is
    // for agents that stamp the model on their status posts and have no frame to read.
    if (!surface || agent === 'claude' || !reportedModel) {
      return
    }
    const catalog = getAgentSessionOptionCatalog(agent)
    if (!catalog) {
      return
    }
    const models =
      (discoveryContext ? readNativeChatEnrichedModels(agent, discoveryContext.hostKey) : null) ??
      catalog.models
    // OMP reports exact selectors, including models absent from cached discovery.
    const matched =
      agent === 'omp'
        ? reportedModel.trim()
        : matchNativeChatCatalogModelId({ ...catalog, models }, reportedModel)
    if (!matched || appliedReportedModelRef.current === matched) {
      return
    }
    appliedReportedModelRef.current = matched
    surface.reportSessionOptions({ model: matched })
  }, [agent, discoveryContext, reportedModel, surface])

  useEffect(() => {
    if (!surface || !discoveryContext) {
      return
    }
    const unsubscribe = subscribeNativeChatEnrichedModels(
      agent,
      discoveryContext.hostKey,
      (models) => {
        surface.replaceModels(models)
        const screen = reportedScreenRef.current
        const reportedValues = screen
          ? readAgentTerminalSessionOptions(agent, screen, models)
          : null
        const current = surface.getSnapshot().find((option) => option.id === 'model')
        const hasPick = current?.valueSource === 'applied' || current?.valueSource === 'dispatched'
        if (reportedValues && !hasPick) {
          surface.reportSessionOptions(reportedValues)
        }
        // A failed settings write must not surface as an unhandled rejection.
        void retirePersistedModelMissingFromDiscovery(agent, models).catch(() => undefined)
      }
    )
    // Why: the subscription never replays, so a probe that settled before this
    // pane mounted would leave a retired persisted model in place forever.
    const cached = readNativeChatEnrichedModels(agent, discoveryContext.hostKey)
    if (cached) {
      void retirePersistedModelMissingFromDiscovery(agent, cached).catch(() => undefined)
    }
    ensureNativeChatModelEnrichment({
      agent,
      hostKey: discoveryContext.hostKey,
      discover: () =>
        discoverNativeChatCatalogModels(agent, discoveryContext.runtime, discoveryContext.hostKey)
    })
    return unsubscribe
  }, [agent, discoveryContext, surface])

  const snapshot = useSyncExternalStore(
    surface?.subscribe ?? subscribeEmpty,
    surface?.getSnapshot ?? getEmptySnapshot,
    surface?.getSnapshot ?? getEmptySnapshot
  )
  return { surface, snapshot }
}
