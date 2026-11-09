import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawnManagedProviderProcess } from '../../provider-process/managed-provider-process'
import { resolveProviderChildEnv } from '../../provider-process/provider-process-launch'
import { stderrIndicatesMissingAppServer } from './codex-app-server-capability-signal'
import { withCliRuntimeOnPath } from '../../../shared/node-cli-command-resolution'
import {
  providerStderrForDisplay,
  supervisedProviderSpawnFailure
} from '../../provider-process/provider-spawn-failure-report'
import {
  killCodexAppServerProcessTree,
  spawnCodexAppServerProcess,
  type CodexAppServerSpawn
} from './codex-app-server-process-tree-kill'
import {
  CodexAppServerUnsupportedError,
  CodexAppServerTimeoutError,
  createCodexAppServerSessionRpc,
  type CodexAppServerRpc,
  type CodexAppServerSessionHooks
} from './codex-app-server-session-rpc'
export {
  CodexAppServerUnsupportedError,
  CodexAppServerTimeoutError,
  isCodexAppServerUnsupportedError,
  isCodexMethodNotFoundError
} from './codex-app-server-session-rpc'
export type {
  CodexAppServerRpc,
  CodexAppServerSessionRpc,
  CodexAppServerSessionHooks
} from './codex-app-server-session-rpc'

export type CodexAppServerInvocation = {
  command: string
  args: string[]
  cwd?: string
  /** Pairs the CLI with its Node runtime to avoid NODE_MODULE_VERSION mismatches; null only for guest launchers. */
  cliPath: string | null
  /** Overlay applied on top of the inherited environment (e.g. CODEX_HOME). */
  env?: Record<string, string>
  /** Keys stripped after the overlay, e.g. CODEX_HOME when targeting the real ~/.codex. */
  envToDelete?: readonly string[]
  timeoutMs: number
  signal?: AbortSignal
  experimentalApi?: boolean
  /** Kill unsupervised plugin trees before stdin EOF; root exit leaves children behind and blocks tree killing. */
  treeKillOnFinish?: boolean
}

const STDERR_DETAIL_MAX_CHARS = 400
const CODEX_APP_SERVER_KILL_SITE = 'codex-app-server-session'

/** Runs a bounded JSONL session; the POSIX supervisor also stops its group if Orca dies. */
export async function runCodexAppServerSession<T>(
  invocation: CodexAppServerInvocation,
  body: (rpc: CodexAppServerRpc) => Promise<T>,
  spawnImpl: CodexAppServerSpawn = spawnCodexAppServerProcess,
  hooks: CodexAppServerSessionHooks = {}
): Promise<T> {
  invocation.signal?.throwIfAborted()
  // Strip CODEX_HOME after the overlay so default-home grants target the real ~/.codex.
  const childEnv = resolveProviderChildEnv(invocation, process.env)
  const pairedEnv = invocation.cliPath
    ? withCliRuntimeOnPath(invocation.cliPath, childEnv)
    : childEnv
  const managed = spawnManagedProviderProcess(
    { command: invocation.command, args: invocation.args, cwd: invocation.cwd },
    {
      site: CODEX_APP_SERVER_KILL_SITE,
      inheritedEnv: pairedEnv,
      spawnImpl: (spec) =>
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the managed spec's first three stdio slots are 'pipe', so stdin, stdout and stderr exist.
        spawnImpl(spec.program, [...(spec.args ?? [])], {
          env: spec.env,
          cwd: spec.cwd,
          // Preserve the supervisor's group-report channel.
          stdio: spec.stdio ?? ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          ...(spec.detached ? { detached: true } : {})
        }) as ChildProcessWithoutNullStreams
    }
  )
  const { child } = managed

  const lifetime = new AbortController()
  let exited = false
  let exitCode: number | null = null
  let forceStop = false
  let rejectSession: (error: Error) => void = () => {}
  const ended = new Promise<never>((_resolve, reject) => {
    rejectSession = reject
  })
  function endSession(error: Error): void {
    if (lifetime.signal.aborted) {
      return
    }
    lifetime.abort(error)
    rejectSession(error)
  }
  const rpc = createCodexAppServerSessionRpc({
    child,
    signal: lifetime.signal,
    hooks,
    fail: endSession
  })

  managed.onExit((exit) => {
    exited = true
    exitCode = exit.code
    endSession(buildEarlyExitError())
  })
  // Spawn failures emit error without exit; reject hooks as well as pending requests.
  child.on('error', (error) => {
    exited = true
    endSession(error)
  })
  child.on('close', () => endSession(buildEarlyExitError()))
  // Exit can race stdin.write(); EPIPE must also release a hook awaiting unrelated work.
  child.stdin.on('error', endSession)

  function stopSession(error: Error): void {
    if (lifetime.signal.aborted) {
      return
    }
    endSession(error)
    forceStop = true
    // A supervised child is stopped by the finally below, which this rejection runs at once.
    if (!managed.supervised && !exited) {
      killCodexAppServerProcessTree(child)
    }
  }
  const deadline = setTimeout(
    () =>
      stopSession(
        new CodexAppServerTimeoutError(
          `codex app-server session exceeded ${invocation.timeoutMs}ms (${invocation.command})`
        )
      ),
    invocation.timeoutMs
  )
  const onAbort = (): void => stopSession(new Error('codex app-server session stopped'))
  if (invocation.signal?.aborted) {
    onAbort()
  } else {
    invocation.signal?.addEventListener('abort', onAbort, { once: true })
  }

  // The supervisor's spawn-failure report reads as Node's own spawn error line.
  function stderrDetail(): string {
    return providerStderrForDisplay(managed.stderrTail()).trim().slice(0, STDERR_DETAIL_MAX_CHARS)
  }

  function buildEarlyExitError(): Error {
    // A supervisor reports a provider it could not start as exit 127; callers classify that error.
    const spawnFailure = managed.supervised
      ? supervisedProviderSpawnFailure(exitCode, managed.stderrTail())
      : null
    if (spawnFailure) {
      return spawnFailure.error
    }
    if (stderrIndicatesMissingAppServer(managed.stderrTail())) {
      return new CodexAppServerUnsupportedError(
        `codex CLI does not support the app-server subcommand: ${stderrDetail()}`
      )
    }
    return new Error(
      `codex app-server exited before completing the session${managed.stderrTail() ? `: ${stderrDetail()}` : ''}`
    )
  }

  try {
    try {
      const session = async (): Promise<T> => {
        const result = await rpc.request('initialize', {
          clientInfo: { name: 'orca_desktop', title: 'Orca', version: '0.0.0' },
          ...(invocation.experimentalApi ? { capabilities: { experimentalApi: true } } : {})
        })
        rpc.notify('initialized')
        lifetime.signal.throwIfAborted()
        await hooks.onInitialized?.(rpc, result)
        lifetime.signal.throwIfAborted()
        return body({ request: rpc.request, notify: rpc.notify, signal: lifetime.signal })
      }
      // Killing the child cannot settle a callback awaiting unrelated work; race the whole callback.
      return await Promise.race([session(), ended])
    } finally {
      lifetime.abort()
      clearTimeout(deadline)
      invocation.signal?.removeEventListener('abort', onAbort)
      // A session past its deadline is wedged; its stdin end would only add a grace.
      if (forceStop && managed.supervised && !exited) {
        try {
          child.stdin.end()
        } catch {
          // A destroyed stdin still leaves the SIGTERM and the close below.
        }
        child.kill('SIGTERM')
      }
      if (invocation.treeKillOnFinish && !managed.supervised && !exited) {
        await managed.terminateTree()
      }
      // Ends stdin, gives a supervisor its full stop time (a direct child 1.5 s), then the tree.
      await managed.close()
    }
  } catch (error) {
    // Root exit precedes stream close; classify capability only after stderr drains.
    if (
      error instanceof Error &&
      !(error instanceof CodexAppServerUnsupportedError) &&
      !(error instanceof CodexAppServerTimeoutError) &&
      stderrIndicatesMissingAppServer(managed.stderrTail())
    ) {
      throw new CodexAppServerUnsupportedError(
        `codex CLI does not support the app-server subcommand: ${stderrDetail()}`
      )
    }
    throw error
  }
}
