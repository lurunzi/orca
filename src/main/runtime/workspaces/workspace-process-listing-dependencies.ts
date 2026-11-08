import { resolveTuiAgentLaunchEnv } from '../../../shared/tui-agent-launch-defaults'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { StructuredAgentId } from '../../../shared/agent-session/lifecycle/agent-session-provider-handle'
import type { RuntimeWorkspaceCatalog } from './workspace-catalog'
import type { OrcaRuntimeWithRefreshPtyWorktreeRecordsFromController } from '../terminal/lifecycle/pty-worktree-refresh'
import type { RuntimeAccountController } from '../runtime-account-controller'
import type { OrcaRuntimeWithPruneMobileSessionTabGroupLayout } from '../session-lifecycle/projection/prune-mobile-session-tab-group-layout'
import type { OrcaRuntimeWithGetStructuredAgentSessionCreateSupport } from '../session-tabs/structured-session-create-support'
import type { OrcaRuntimeWithGetPtyRecordForPaneKey } from '../orchestration/terminal-pane-mail-routing'
import { OrcaRuntimeWithStartTuiIdleVisibleReadProbe } from '../terminal/wait/terminal-wait-visible-probe'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import type { Repo } from '../../../shared/repo-types'
import { readUsageLimitAccountReading } from '../../rate-limits/usage-limit-account-reading'
import type { RateLimitState } from '../../../shared/rate-limit-types'

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
import { escalateChatWorkerError } from '../orchestration/chat-worker-error-escalation'
import type { StructuredAgentSessionRequestFailure } from '../../native-chat/agent-session-wire/structured-agent-session-request-failures'
import type { StructuredAgentSessionHostDeps } from '../../native-chat/agent-session-wire/structured-agent-session-host-types'

export abstract class OrcaRuntimeWithWorktreePsDependencies extends OrcaRuntimeWithStartTuiIdleVisibleReadProbe {
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

  /** Read the setting live so turning it off stops every pending automatic continuation. */
  protected usageLimitAutoContinueHostDeps(): StructuredAgentSessionHostDeps['usageLimitAutoContinue'] {
    return {
      isEnabled: () =>
        this.requireStore().getSettings().nativeChatAutoContinueAfterUsageLimit === true,
      subscribe: (changed) => this.requireStore().onSettingsChanged?.(changed) ?? (() => {}),
      isWorkspaceAsleep: (workspaceId) => this.isWorktreeTerminalSleepHeld(workspaceId),
      // Chats launch under the selected account, whose usage is the active reading.
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
  abstract onStructuredSessionStatusForMail(
    ...args: Parameters<OrcaRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionStatusForMail']>
  ): ReturnType<OrcaRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionStatusForMail']>
  protected abstract assertStructuredChatAcquireAdmissible(
    record: AgentSessionRecord
  ): Promise<void>
  abstract onStructuredSessionTabHidden(
    ...args: Parameters<OrcaRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionTabHidden']>
  ): ReturnType<OrcaRuntimeWithGetPtyRecordForPaneKey['onStructuredSessionTabHidden']>

  listRepos(): Repo[] {
    return this.store?.getRepos() ?? []
  }

  /** A chat worker whose request settled failed tells the Run that dispatched it. */
  onStructuredRequestFailureForErrorMail(failure: StructuredAgentSessionRequestFailure): void {
    void escalateChatWorkerError(failure, this.workerTurnStopReportDeps)
  }
}
