import { useAgentStatus } from '@/runtime/agent-status/use-agent-status'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { AgentType } from '../../../../../../../shared/agent-status/contracts/agent-status-types'
import { getAgentSessionOptionCatalog } from '../../../../../../../shared/agent-session/options/agent-session-option-catalog'
import {
  takeNativeChatStatusReport,
  type NativeChatStatusReportMemory
} from '../../../../../../../shared/native-chat/input/session-options/native-chat-status-session-options'
import type { SessionOptionDescriptor } from '../../../../../../../shared/native-chat/input/native-chat-session-options'
import { sayNativeChatSessionOptionTranslated } from '../controls/native-chat-session-option-labels-text'
import {
  createNativeChatPtySessionOptions,
  type NativeChatPtySessionOptionsSurface
} from '../../../../../../../shared/native-chat/input/session-options/native-chat-pty-session-options'
import type { NativeChatSessionOptionDispatchCommand } from '../../../../../../../shared/native-chat/input/session-options/native-chat-session-option-dispatch'
import {
  ensureNativeChatModelEnrichment,
  readNativeChatEnrichedModels,
  subscribeNativeChatEnrichedModels
} from '../catalog/native-chat-session-option-enrichment'
import {
  discoverNativeChatCatalogModels,
  resolveNativeChatModelDiscoveryContext
} from '../catalog/native-chat-session-option-discovery'
import { readAntigravityTerminalSessionOptions } from '../../../../../../../shared/antigravity-terminal-session-options'

import { enqueueSessionOptionSettingsWrite } from '../native-chat-session-option-settings-write'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'

const EMPTY_SNAPSHOT: SessionOptionDescriptor[] = []
const subscribeEmpty = (): (() => void) => () => {}
const getEmptySnapshot = (): SessionOptionDescriptor[] => EMPTY_SNAPSHOT

const CLIENT_SETTINGS_TARGET = { kind: 'local' } as const

// Kept across chat remounts, as on the phone: the same agent session repeating its model is not
// fresh evidence, and reapplying it would revert a newer pick.
const appliedReportByPty: NativeChatStatusReportMemory = new Map()

export function useNativeChatSessionOptions(args: {
  agent: AgentType
  terminalTabId: string
  targetPtyId: string | null
  dispatchCommand: NativeChatSessionOptionDispatchCommand
  onAgentPicker?: () => void
  /** Fork: the hosted TUI's screen, where Antigravity's startup frame names its model. */
  readTerminalScreen?: () => string | null
  /** The pane whose agent status reports the session's model and effort, as it does on the phone. */
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
  const status = useAgentStatus(paneKey)
  const reportedModel = status?.model
  const reportingSessionId = status?.providerSession?.id
  const reportedEffort = status?.providerSession?.effort
  const canSwitchOmpModel = status?.modelSwitchCommand === 'orca-model'
  // Host discovery can resolve a reported id the seed families only matched by family.
  const [discoveredModelsRevision, setDiscoveredModelsRevision] = useState(0)
  // Cache the parsed screen so late discovery can resolve its model to a host model id.
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
    // Fork: Antigravity names its model only in its startup frame; its hooks never report one.
    const reportedValues =
      agent === 'antigravity'
        ? readAntigravityTerminalSessionOptions(
            readTerminalScreen?.(),
            discoveredModels ?? undefined
          )
        : null
    const created = createNativeChatPtySessionOptions({
      agent,
      scopeKey,
      ...(targetPtyId ? { fallbackScopeKey: terminalTabId } : {}),
      // Version-neutral family seeds keep the picker available while host discovery runs or fails.
      ...(discoveryContext ? { initialModels: discoveredModels ?? undefined } : {}),
      mode: targetPtyId ? 'live' : 'draft',
      modelLabel: sayNativeChatSessionOptionTranslated('model'),
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
    if (!created) {
      return null
    }
    // A rebuilt surface keeps a model the user picked over the startup frame's.
    const picked = created.getSnapshot().find((option) => option.id === 'model')?.valueSource
    if (reportedValues && picked !== 'applied' && picked !== 'dispatched') {
      created.reportSessionOptions(reportedValues)
    }
    return created
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
    if (!surface || agent !== 'antigravity') {
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
      const reportedValues = readAntigravityTerminalSessionOptions(screen, models ?? undefined)
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
    // Retries stop once a screen answers or after 60 reads; a hidden window pauses them.
    let stopRetry = (): void => {}
    stopRetry = installWindowVisibilityInterval({
      run: () => {
        if (found || attempts >= 60) {
          stopRetry()
          return
        }
        attempts += 1
        void reportCurrentValues()
      },
      intervalMs: 1_000
    })
    return () => {
      cancelled = true
      stopRetry()
    }
  }, [agent, discoveryContext, readTerminalScreen, surface, targetPtyId])

  useEffect(() => {
    if (!surface || !reportedModel || !targetPtyId) {
      return
    }
    const catalog = getAgentSessionOptionCatalog(agent)
    if (!catalog) {
      return
    }
    const models =
      (discoveryContext ? readNativeChatEnrichedModels(agent, discoveryContext.hostKey) : null) ??
      catalog.models
    // A new agent or session in the same terminal reports afresh, even the same model.
    const report = takeNativeChatStatusReport(
      appliedReportByPty,
      targetPtyId,
      agent,
      catalog,
      models,
      {
        model: reportedModel,
        providerSession: { id: reportingSessionId, effort: reportedEffort }
      }
    )
    if (report) {
      surface.reportSessionOptions(report.values, report.forNewModel)
    }
  }, [
    agent,
    discoveredModelsRevision,
    discoveryContext,
    reportedEffort,
    reportedModel,
    reportingSessionId,
    surface,
    targetPtyId
  ])

  useEffect(() => {
    if (!surface || !discoveryContext) {
      return
    }
    const unsubscribe = subscribeNativeChatEnrichedModels(
      agent,
      discoveryContext.hostKey,
      (models) => {
        surface.replaceModels(models)
        setDiscoveredModelsRevision((revision) => revision + 1)
        const screen = agent === 'antigravity' ? reportedScreenRef.current : null
        const reportedValues = screen ? readAntigravityTerminalSessionOptions(screen, models) : null
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
