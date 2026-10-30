import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import { matchNativeChatCatalogModelId } from '../../../../shared/native-chat/input/native-chat-session-option-state'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat/input/native-chat-session-options'
import { useAppStore } from '../../store'
import { sayNativeChatSessionOptionTranslated } from './native-chat-session-option-labels-text'
import {
  createNativeChatPtySessionOptions,
  type NativeChatPtySessionOptionsSurface
} from '../../../../shared/native-chat-pty-session-options'
import type { NativeChatSessionOptionDispatchCommand } from '../../../../shared/native-chat-session-option-dispatch'
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

export function useNativeChatSessionOptions(args: {
  agent: AgentType
  terminalTabId: string
  targetPtyId: string | null
  dispatchCommand: NativeChatSessionOptionDispatchCommand
  onAgentPicker?: () => void
  readTerminalScreen?: () => string | null
  /** OMP model evidence comes from its hook; Claude uses its terminal frame. */
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
  const reportedModel = useAppStore((state) =>
    paneKey ? (state.agentStatusByPaneKey[paneKey]?.model ?? null) : null
  )
  const canSwitchOmpModel = useAppStore((state) =>
    paneKey ? state.agentStatusByPaneKey[paneKey]?.modelSwitchCommand === 'orca-model' : false
  )
  // Only changed hook models are new evidence; repeated status pings must not undo newer user picks.
  const appliedReportedModelRef = useRef<string | null>(null)
  // Cache parsed screen text so late discovery can resolve real host model IDs.
  const reportedScreenRef = useRef<string | null>(null)
  const discoveryContext = useMemo(
    () => resolveNativeChatModelDiscoveryContext(terminalTabId),
    [terminalTabId]
  )
  const refreshModels = useCallback(() => {
    if (!discoveryContext) {
      return
    }
    ensureNativeChatModelEnrichment({
      agent,
      hostKey: discoveryContext.hostKey,
      discover: () =>
        discoverNativeChatCatalogModels(agent, discoveryContext.runtime, discoveryContext.hostKey)
    })
  }, [agent, discoveryContext])
  const surface = useMemo(() => {
    // Chat attaches after startup is queued, so a draft picker could no longer change its command.
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
      // Version-neutral family seeds keep the picker available while host discovery runs or fails.
      ...(discoveryContext ? { initialModels: discoveredModels ?? undefined } : {}),
      mode: targetPtyId ? 'live' : 'draft',
      modelLabel: sayNativeChatSessionOptionTranslated('model'),
      reportedValues,
      dispatchCommand,
      refresh: refreshModels,
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
    refreshModels,
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
          // Main-buffer snapshots are stale during alternate-screen TUIs; use mounted xterm then.
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

  // Scope survives surface rebuilds; reapplying an unchanged report would revert the user’s pick.
  useEffect(() => {
    appliedReportedModelRef.current = null
  }, [agent, targetPtyId, terminalTabId])

  useEffect(() => {
    // Claude uses terminal-frame evidence; other agents report model IDs in status hooks.
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
        : matchNativeChatCatalogModelId({ ...catalog, models }, reportedModel, {
            allowUnlisted: agent === 'codex'
          })
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
      }
    )
    refreshModels()
    return unsubscribe
  }, [agent, discoveryContext, refreshModels, surface])

  const snapshot = useSyncExternalStore(
    surface?.subscribe ?? subscribeEmpty,
    surface?.getSnapshot ?? getEmptySnapshot,
    surface?.getSnapshot ?? getEmptySnapshot
  )
  return { surface, snapshot }
}
