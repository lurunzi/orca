import { waitForPromiseWithSignal } from '../../../../shared/abort-signal-reason'
import { requireLegacyAgentSessionAccountHome } from '../../../../shared/agent-session/lifecycle/agent-session-account-home'
import type { CodexPoolIdentity } from '../../../../shared/agent-session/lifecycle/agent-session-pool-account'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import { CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS } from '../../../codex-cli/codex-read-only-app-server-args'
import {
  LEGACY_NATIVE_CHAT_VISUALS_DIR_ENV,
  NATIVE_CHAT_SCRATCH_DIR_ENV
} from '../../../native-chat/native-chat-visuals-delivery'
import type { CodexAppServerRpc } from '../../app-server/codex-app-server-session'
import { codexStructuredLaunchArgs } from '../launch/codex-structured-launch-args'
import { resolveCodexStructuredInvocation } from '../launch/codex-structured-launch-resolution'
import {
  codexProviderProbeCwd,
  type CodexProviderInvocationDeps
} from './codex-provider-session-rename'
import type {
  CodexPreparedShortLivedInvocation,
  CodexShortLivedOperationOptions,
  CodexShortLivedOperations
} from './codex-short-lived-operations'

/** Dashboard pool mode: an orcad instance bound to the Dashboard, or a chat pinned to a pool account. */
export function isCodexPoolRecord(record: AgentSessionRecord | undefined): boolean {
  return process.env.ORCA_DASHBOARD_INSTANCE_ID !== undefined || !!record?.poolAccount
}

export async function codexPoolProviderProbeCwd(
  record: AgentSessionRecord,
  deps: CodexProviderInvocationDeps,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  // A cancelled lookup must not reach the hidden fallback, which creates its directory.
  const cwd = await codexProviderProbeCwd(record, {
    ...deps,
    resolveWorkspacePath: (workspaceId) =>
      waitForPromiseWithSignal(deps.resolveWorkspacePath(workspaceId), signal)
  })
  signal?.throwIfAborted()
  return cwd
}

/** Mirrors runCodexProviderAppServer's launch so the owner can authenticate before spawning it. */
export async function prepareCodexPoolProviderInvocation(
  record: AgentSessionRecord,
  invocation: CodexProviderInvocationDeps,
  options: CodexShortLivedOperationOptions,
  signal?: AbortSignal
): Promise<CodexPreparedShortLivedInvocation> {
  signal?.throwIfAborted()
  const codexHome = requireLegacyAgentSessionAccountHome(record.accountHome).path
  const cwd = await codexPoolProviderProbeCwd(record, invocation, signal)
  const { command, prefixArgs, environment } = await waitForPromiseWithSignal(
    resolveCodexStructuredInvocation({
      ...invocation,
      ...(signal ? { signal } : {}),
      resolveWorkingDirectory: () => cwd
    }),
    signal
  )
  const args = codexStructuredLaunchArgs(
    await waitForPromiseWithSignal(Promise.resolve(invocation.resolveLaunchArgs()), signal)
  )
  signal?.throwIfAborted()
  const env = Object.fromEntries(
    Object.entries(environment ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )
  return {
    cwd,
    invocation: {
      command,
      args: [...prefixArgs, ...args, ...CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS],
      cwd,
      cliPath: command,
      env: { ...env, CODEX_HOME: codexHome },
      envToDelete: [NATIVE_CHAT_SCRATCH_DIR_ENV, LEGACY_NATIVE_CHAT_VISUALS_DIR_ENV],
      timeoutMs: options.timeoutMs,
      ...(options.experimentalApi !== undefined
        ? { experimentalApi: options.experimentalApi }
        : {}),
      ...(signal ? { signal } : {})
    }
  }
}

export function runCodexPoolProviderAppServer<T>(
  owner: CodexShortLivedOperations,
  record: AgentSessionRecord,
  invocation: CodexProviderInvocationDeps,
  options: CodexShortLivedOperationOptions,
  body: (rpc: CodexAppServerRpc, cwd: string, identity: CodexPoolIdentity | null) => Promise<T>
): Promise<T> {
  return owner.run(
    record,
    options,
    (signal) => prepareCodexPoolProviderInvocation(record, invocation, options, signal),
    body
  )
}
