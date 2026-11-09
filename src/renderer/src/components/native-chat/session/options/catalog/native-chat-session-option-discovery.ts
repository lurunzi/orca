import type { AgentType } from '../../../../../../../shared/agent-status/contracts/agent-status-types'
import { createClaudeCatalogOptions } from '../../../../../../../shared/agent-session/options/agent-session-option-catalog-claude-codex'
import type { CatalogModel } from '../../../../../../../shared/agent-session/options/agent-session-option-catalog-types'
import { catalogModelsFromModelDiscovery } from '../../../../../../../shared/native-chat/input/native-chat-discovered-catalog-models'
import {
  getCommitMessageModelDiscoveryHostKeyForLocalRuntime,
  getCommitMessageModelDiscoveryHostKeyForScope,
  LOCAL_COMMIT_MESSAGE_HOST_KEY
} from '../../../../../../../shared/source-control/ai/generation/commit-message-host-key'
import { runtimeTargetForWorkspaceOwner } from '@/lib/workspace/ownership/resolve-owner'
import { hasExplicitTuiLaunchCommand } from '../../../../../../../shared/agent-launch/startup/tui-agent-launch-command-override'
import { getConnectionIdFromState } from '@/lib/workspace/ownership/connection-owner-resolution'
import {
  getLocalProjectExecutionRuntimeContext,
  getWslDistroFromPath
} from '@/lib/local-preflight-context'
import { discoverRuntimeCommitMessageModels } from '@/runtime/source-control/git/runtime-git-generation-client'
import {
  getRuntimeGitScope,
  type RuntimeGitContext
} from '@/runtime/source-control/git/runtime-git-client-context'
import { callStructuredAgentSession } from '@/runtime/native-chat/requests/structured-agent-session-call'
import type {
  AgentSessionModelCatalogResult,
  AgentSessionModelOption
} from '../../../../../../../shared/agent-session/agent-session-wire'
import { useAppStore } from '@/store/index'
import { selectFileListWorktree } from '@/store/workspaces/selection/known-worktree-selection'
import {
  loadNativeChatEnrichedModels,
  readNativeChatEnrichedModels
} from './native-chat-session-option-enrichment'

export type NativeChatModelDiscoveryContext = {
  hostKey: string
  runtime: RuntimeGitContext
}

export function resolveNativeChatModelDiscoveryHostKey(
  state: Parameters<typeof getLocalProjectExecutionRuntimeContext>[0],
  worktreeId: string | null,
  worktreePath: string,
  scope: string | null | undefined
): string {
  if (scope !== null) {
    return getCommitMessageModelDiscoveryHostKeyForScope(scope)
  }
  const localProjectRuntime = getLocalProjectExecutionRuntimeContext(state, worktreeId)
  const wslDistro =
    localProjectRuntime?.status === 'resolved' && localProjectRuntime.runtime.kind === 'wsl'
      ? localProjectRuntime.runtime.distro
      : getWslDistroFromPath(worktreePath)
  return getCommitMessageModelDiscoveryHostKeyForLocalRuntime(wslDistro)
}

export function resolveNativeChatModelDiscoveryContext(
  terminalTabId: string
): NativeChatModelDiscoveryContext | null {
  const state = useAppStore.getState()
  const worktreeId =
    Object.entries(state.tabsByWorktree ?? {}).find(([, tabs]) =>
      tabs.some((tab) => tab.id === terminalTabId)
    )?.[0] ?? null
  return resolveNativeChatModelDiscoveryContextForWorktree(worktreeId)
}

/** A launch resolves its worktree's discovery host before the tab exists. */
export function resolveNativeChatModelDiscoveryContextForWorktree(
  worktreeId: string | null
): NativeChatModelDiscoveryContext | null {
  const state = useAppStore.getState()
  const runtime = resolveWorktreeModelDiscoveryRuntime(state, worktreeId)
  if (!runtime) {
    return null
  }
  // The context omits a null connection id; the host key still needs it to mean "this machine".
  const scope = getRuntimeGitScope(runtime.target, getConnectionIdFromState(state, worktreeId))
  return {
    hostKey: resolveNativeChatModelDiscoveryHostKey(state, worktreeId, runtime.worktreePath, scope),
    runtime
  }
}

/** How to ask a worktree's owner for models; null when the owner cannot be named. */
export function resolveWorktreeModelDiscoveryRuntime(
  state: ReturnType<typeof useAppStore.getState>,
  worktreeId: string | null
): RuntimeGitContext | null {
  const connectionId = getConnectionIdFromState(state, worktreeId)
  if (worktreeId && connectionId === undefined) {
    return null
  }
  // Why: discovery asks the worktree's owner; an owner the rows can't name gets no models.
  const target = worktreeId
    ? runtimeTargetForWorkspaceOwner(state, { workspaceId: worktreeId })
    : ({ kind: 'local' } as const)
  if (!target) {
    return null
  }
  return {
    target,
    prefs: state.settings,
    worktreeId,
    worktreePath: selectFileListWorktree(state, worktreeId)?.path ?? '',
    ...(connectionId ? { connectionId } : {})
  }
}

function catalogModelsFromHostCatalog(
  agent: 'claude' | 'codex',
  models: AgentSessionModelOption[]
): CatalogModel[] {
  return models.map((model) => ({
    id: model.id,
    label: model.label,
    ...(model.description ? { description: model.description } : {}),
    ...(model.isDefault ? { isDefault: true as const } : {}),
    options:
      agent === 'claude'
        ? createClaudeCatalogOptions({
            effortLevelIds: model.efforts.map((effort) => effort.value),
            ...(model.supportsFastMode !== undefined
              ? { supportsFastMode: model.supportsFastMode }
              : {})
          })
        : []
  }))
}

/** Missing or unsupported host catalogs fall back to CLI listing for mixed-version hosts. */
async function readLocalHostCatalogModels(
  agent: 'claude' | 'codex'
): Promise<CatalogModel[] | null> {
  try {
    const result = await callStructuredAgentSession<AgentSessionModelCatalogResult>(
      { kind: 'local' },
      'agentSession.modelCatalog',
      { agent }
    )
    if (result.origin === 'unknown' || result.models.length === 0) {
      return null
    }
    return catalogModelsFromHostCatalog(agent, result.models)
  } catch {
    return null
  }
}

export async function discoverNativeChatCatalogModels(
  agent: AgentType,
  context: RuntimeGitContext,
  hostKey?: string
): Promise<CatalogModel[] | null> {
  // Use this machine’s host catalog when available; other owners and unlisted hosts use CLI discovery.
  const hostCatalogAgent =
    agent === 'claude' ? ('claude' as const) : agent === 'codex' ? ('codex' as const) : null
  // Only local proves native ownership; paired keys may cover SSH/WSL, and custom commands need CLI discovery.
  if (
    hostCatalogAgent &&
    hostKey === LOCAL_COMMIT_MESSAGE_HOST_KEY &&
    !hasExplicitTuiLaunchCommand(context.prefs, hostCatalogAgent)
  ) {
    const fromHost = await readLocalHostCatalogModels(hostCatalogAgent)
    if (fromHost) {
      return fromHost
    }
  }
  return catalogModelsFromModelDiscovery(
    agent,
    await discoverRuntimeCommitMessageModels(context, agent)
  )
}

/** Model ids already discovered this session on the worktree's host; null before any discovery. */
export function readNativeChatDiscoveredModelIdsForWorktree(
  agent: AgentType,
  worktreeId: string | null
): string[] | null {
  const context = resolveNativeChatModelDiscoveryContextForWorktree(worktreeId)
  const models = context ? readNativeChatEnrichedModels(agent, context.hostKey) : null
  return models ? models.map((model) => model.id) : null
}

/** The models a terminal-backed chat on this worktree's host lists, shared with its in-chat picker. */
export async function loadNativeChatCatalogModelsForWorktree(
  agent: AgentType,
  worktreeId: string | null
): Promise<CatalogModel[] | null> {
  const context = resolveNativeChatModelDiscoveryContextForWorktree(worktreeId)
  if (!context) {
    return null
  }
  return await loadNativeChatEnrichedModels({
    agent,
    hostKey: context.hostKey,
    discover: () => discoverNativeChatCatalogModels(agent, context.runtime, context.hostKey)
  })
}
