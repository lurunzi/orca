import { app } from 'electron'
import { KeybindingService } from '../keybindings/keybinding-service'
import { createProviderAccountServices } from '../providers/accounts/provider-account-services'
import { createCodexSessionMigrationScheduler } from '../codex/history/backfill/codex-session-migration-scheduler'
import { startCodexSessionBackfillInBackground } from '../codex/history/backfill/codex-session-backfill'
import { startCodexSessionIndexHealInBackground } from '../codex/history/index/codex-session-index-heal'
import { startCodexStateDbBackfillRecoveryInBackground } from '../codex/history/index/codex-state-db-backfill-recovery'
import {
  getOrcaManagedCodexHomePath,
  getSystemCodexHomePath
} from '../codex/configuration/homes/codex-home-paths'
import { installCodexStructuredAccountSwitch } from '../codex/structured/launch/codex-structured-account-switch'
import { isCodexHistorySharedAcrossAccounts } from '../codex-accounts/codex-history-sharing'
import { codexStructuredLaunchHomeResolvers } from './codex-launch-preparation'
import { prepareCodexPinnedLaunchHome } from './codex-session-resume-launch'
import {
  hasOpenCodeGoApiKey,
  readOpenCodeGoApiKey,
  saveOpenCodeGoApiKey
} from '../opencode/opencode-go-api-key-store'
import { agentHookServer } from '../agent-hooks/server'
import { resolveHostCodexSessionSourceHome } from '../codex/history/rollouts/codex-session-source-home'
import { browserManager } from '../browser/browser-manager'
import { prewarmStructuredAgentModelCatalogs } from '../runtime/agent-session/model-catalog/structured-agent-model-catalog-wiring'
import { mainProcessState as state } from './main-process-state'

// Settings that change which account or binary a new chat's agent runs under.
const MODEL_CATALOG_ACCOUNT_SETTINGS = [
  'activeCodexManagedAccountId',
  'activeCodexManagedAccountIdsByRuntime',
  'codexManagedAccounts',
  'activeClaudeManagedAccountId',
  'activeClaudeManagedAccountIdsByRuntime',
  'claudeManagedAccounts',
  'agentDefaultEnv',
  'agentCmdOverrides'
] as const

export function initializeMainProcessAccountServices(): void {
  const store = state.store
  if (
    !store ||
    !state.claudeUsage ||
    !state.codexUsage ||
    !state.openCodeUsage ||
    !state.museUsage
  ) {
    throw new Error('Usage stores must be initialized before account services')
  }
  state.codexSessionMigration = createCodexSessionMigrationScheduler({
    isEligible: () =>
      state.codexRuntimeHome?.isHostSystemDefaultSessionMigrationEligible() === true,
    isQuitting: () => state.isQuitting,
    resolveSystemCodexHomePathOverride: () =>
      resolveHostCodexSessionSourceHome(store.getSettings()),
    prepareScheduledRun: (scanDates) =>
      state.codexRuntimeHome?.prepareHostSystemDefaultSessionMigrationPass(scanDates),
    finishScheduledRun: () => state.codexRuntimeHome?.finishHostSystemDefaultSessionMigrationPass(),
    startBackfill: startCodexSessionBackfillInBackground,
    startIndexHeal: startCodexSessionIndexHealInBackground
  })
  const services = createProviderAccountServices(store, {
    codexAccountLifecycle: { onHostSystemDefaultSelected: state.codexSessionMigration.requestRun },
    setClaudeStatusLineListener: (listener) => agentHookServer.setClaudeStatusLineListener(listener)
  })
  state.rateLimits = services.rateLimits
  state.codexRuntimeHome = services.codexRuntimeHome
  state.codexAccounts = services.codexAccounts
  state.claudeRuntimeAuth = services.claudeRuntimeAuth
  state.claudeAccounts = services.claudeAccounts
  const { codexRuntimeHome } = services
  installCodexStructuredAccountSwitch({
    isEnabled: () => isCodexHistorySharedAcrossAccounts(store.getSettings()),
    prepareLaunchHome: async (input) =>
      codexStructuredLaunchHomeResolvers.prepareCodexStructuredLaunch(input),
    selectableHomes: () => [
      ...codexRuntimeHome.getHostCodexHomePathsForSessionDiscovery(),
      getSystemCodexHomePath()
    ],
    systemHomePath: getSystemCodexHomePath,
    preparePinnedLaunchHome: (home) => prepareCodexPinnedLaunchHome(home),
    workspaceTrustSettings: () => store.getSettings()
  })
  void startCodexStateDbBackfillRecoveryInBackground(getOrcaManagedCodexHomePath())
  // Defer shared-home migration; compatibility launches re-arm non-destructive scans for new rollouts (#4444, #8612, #12480).
  state.codexSessionMigration.scheduleInitialRun()
  store.onSettingsChanged((updates) => {
    // An account switch would otherwise leave the next chat's picker on a cold catalog.
    if (MODEL_CATALOG_ACCOUNT_SETTINGS.some((key) => key in updates)) {
      prewarmStructuredAgentModelCatalogs()
    }
  })
  store.migrateLegacyOpenCodeGoApiKey({
    has: hasOpenCodeGoApiKey,
    read: readOpenCodeGoApiKey,
    save: saveOpenCodeGoApiKey
  })
  state.keybindings = new KeybindingService({
    homePath: app.getPath('home'),
    getLegacyOverrides: () => store.getSettings().keybindings,
    legacyTabSwitchSeed: {
      isPending: () => store.getSettings().tabSwitchKeybindingSeed === 'pending',
      markSeeded: () => store.updateSettings({ tabSwitchKeybindingSeed: 'done' })
    }
  })
  browserManager.setSettingsResolver(() => ({ keybindings: state.keybindings?.getOverrides() }))
}
