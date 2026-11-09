import { ensureStructuredAgentModelCatalogOwner } from '../model-catalog/structured-agent-model-catalog-wiring'
import type { StructuredAgentModelCatalogDeps } from './structured-agent-runtime-registration-types'
import { resolveStructuredCodexAccountKind } from '../environment/structured-agent-account-home'
import { nativeChatShellEnvironmentPolicy } from '../../../../shared/native-chat/native-chat-shell-environment'
import { claudeStructuredAuthPolicyForSettings } from '../../../claude-accounts/claude-structured-auth-policy'
import { resolveStructuredAgentCommand } from '../../../native-chat/structured-agent-command-resolution'
import { structuredAgentConfiguredArgs } from '../../../native-chat/structured-agent-configured-args'
import { getProfileUserDataPath } from '../../../orca-profiles/profile-storage-paths'
import { isTuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent-config'
import { resolveTuiAgentLaunchEnv } from '../../../../shared/agent-launch/choices/tui-agent-launch-defaults'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { StructuredAgentId } from '../../../../shared/agent-session/lifecycle/agent-session-provider-handle'
import type { RuntimeWorkspaceCatalog } from '../../workspaces/catalog/workspace-catalog'
import type { OrcaRuntimeWithRefreshPtyWorktreeRecordsFromController } from '../../terminal/lifecycle/pty-worktree-refresh'
import type { RuntimeAccountController } from '../environment/runtime-account-controller'
import type { OrcaRuntimeWithPruneMobileSessionTabGroupLayout } from '../../session-lifecycle/projection/prune-mobile-session-tab-group-layout'
import type { OrcaRuntimeWithGetStructuredAgentSessionCreateSupport } from '../../session-tabs/structured-session-create-support'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import type { StructuredAgentSessionHostDeps } from '../../../native-chat/agent-session-wire/host/structured-agent-session-host-types'
import { OrcaRuntimeWithStartTuiIdleVisibleReadProbe } from '../../terminal/wait/terminal-wait-visible-probe'
import { readUsageLimitAccountReading } from '../../../rate-limits/usage-limit-account-reading'
import type { RateLimitState } from '../../../../shared/rate-limit-types'

const ACCOUNT_USAGE_OF_PROVIDER: Record<
  string,
  (state: RateLimitState) => RateLimitState['claude']
> = {
  claude: (state) => state.claude,
  codex: (state) => state.codex,
  cursor: (state) => state.cursor,
  antigravity: (state) => state.antigravity
}
const POOLED_PROVIDERS = new Set(['cursor', 'antigravity'])

export abstract class RuntimeStructuredAgentHost extends OrcaRuntimeWithStartTuiIdleVisibleReadProbe {
  abstract notifyStructuredSessionJournalActivity(sessionId: string): void
  /** Apply the host-owning desktop's account overlay to configured agent environment. */
  protected structuredAgentLaunchEnv(
    agent: StructuredAgentId,
    settings: Pick<GlobalSettings, 'agentDefaultEnv'>
  ) {
    return {
      ...resolveTuiAgentLaunchEnv(agent, settings),
      ...this.accounts.hostLaunchEnvFor(agent)
    }
  }

  protected structuredAgentCatalogDependencies(): StructuredAgentModelCatalogDeps {
    return {
      stateDirectory: getProfileUserDataPath(),
      // Resolve plain folder workspaces as well as git worktrees.
      resolveWorkspacePath: async (workspaceId) =>
        (await this.resolveRuntimeFileTarget(`id:${workspaceId}`)).worktree.path,
      resolveClaudeCommand: (options) =>
        resolveStructuredAgentCommand('claude', this.requireStore().getSettings(), options),
      resolveCodexCommand: (options) =>
        resolveStructuredAgentCommand('codex', this.requireStore().getSettings(), options),
      resolveLaunchArgs: (agent) =>
        structuredAgentConfiguredArgs(agent, this.requireStore().getSettings()),
      resolveShellEnvironmentPolicy: () =>
        nativeChatShellEnvironmentPolicy(this.requireStore().getSettings()),
      resolveClaudeAuthPolicy: () =>
        claudeStructuredAuthPolicyForSettings(this.requireStore().getSettings()),
      resolveAgentLaunchEnv: (agent) =>
        isTuiAgent(agent)
          ? this.structuredAgentLaunchEnv(agent, this.requireStore().getSettings())
          : {},
      resolveAgentCommandSettings: () => this.requireStore().getSettings(),
      resolveCodexAccountKind: (home) =>
        resolveStructuredCodexAccountKind(home, this.requireStore().getSettings()),
      resolveAgentAccountHome: (agent) => this.resolveStructuredAgentAccountHome(agent),
      ...(this.prepareCodexCatalogProbeHomeFn
        ? { prepareCodexCatalogProbeHome: this.prepareCodexCatalogProbeHomeFn }
        : {})
    }
  }

  async structuredAgentModelCatalog() {
    return (await ensureStructuredAgentModelCatalogOwner(this.structuredAgentCatalogDependencies()))
      .modelCatalog
  }

  /** Read the setting live so turning it off stops every pending automatic continuation. */
  protected usageLimitAutoContinueHostDeps(): StructuredAgentSessionHostDeps['usageLimitAutoContinue'] {
    return {
      isEnabled: () =>
        this.requireStore().getSettings().nativeChatAutoContinueAfterUsageLimit === true,
      subscribe: (changed) => this.requireStore().onSettingsChanged?.(changed) ?? (() => {}),
      isWorkspaceAsleep: (workspaceId) => this.isWorktreeTerminalSleepHeld(workspaceId),
      readAccountUsage: (provider) => {
        const state = this.accounts.usageRateLimits()?.getState()
        const limits = state ? ACCOUNT_USAGE_OF_PROVIDER[provider]?.(state) : undefined
        return limits === undefined
          ? null
          : readUsageLimitAccountReading(limits, { pooled: POOLED_PROVIDERS.has(provider) })
      },
      refreshAccountUsage: async () => {
        await this.accounts
          .usageRateLimits()
          ?.refresh()
          .catch(() => {})
      }
    }
  }

  protected abstract listResolvedWorktreeSnapshot(
    ...args: Parameters<RuntimeWorkspaceCatalog['listResolvedWorktreeSnapshot']>
  ): ReturnType<RuntimeWorkspaceCatalog['listResolvedWorktreeSnapshot']>

  protected abstract refreshPtyWorktreeRecordsFromController(
    ...args: Parameters<
      OrcaRuntimeWithRefreshPtyWorktreeRecordsFromController['refreshPtyWorktreeRecordsFromController']
    >
  ): ReturnType<
    OrcaRuntimeWithRefreshPtyWorktreeRecordsFromController['refreshPtyWorktreeRecordsFromController']
  >

  protected abstract isWorktreeTerminalSleepHeld(workspaceId: string): boolean

  abstract notifyFolderWorkspaceChanged(): void

  abstract notifyBranchRenamed(repoId: string): void

  abstract notifyWorktreeFolderRenamed(
    repoId: string,
    oldWorktreeId: string,
    newWorktreeId: string
  ): void

  declare getCommitMessageAgentEnvironmentResolvers: RuntimeAccountController['getCommitMessageAgentEnvironment']

  abstract refreshStructuredConversationTabTitle(
    ...args: Parameters<
      OrcaRuntimeWithPruneMobileSessionTabGroupLayout['refreshStructuredConversationTabTitle']
    >
  ): ReturnType<
    OrcaRuntimeWithPruneMobileSessionTabGroupLayout['refreshStructuredConversationTabTitle']
  >

  abstract resolveStructuredAgentAccountHome(
    ...args: Parameters<
      OrcaRuntimeWithGetStructuredAgentSessionCreateSupport['resolveStructuredAgentAccountHome']
    >
  ): ReturnType<
    OrcaRuntimeWithGetStructuredAgentSessionCreateSupport['resolveStructuredAgentAccountHome']
  >

  abstract resolveStructuredAgentLaunchAccountHome(
    ...args: Parameters<
      OrcaRuntimeWithGetStructuredAgentSessionCreateSupport['resolveStructuredAgentLaunchAccountHome']
    >
  ): ReturnType<
    OrcaRuntimeWithGetStructuredAgentSessionCreateSupport['resolveStructuredAgentLaunchAccountHome']
  >

  protected abstract assertStructuredChatAcquireAdmissible(
    record: AgentSessionRecord
  ): Promise<void>
}
