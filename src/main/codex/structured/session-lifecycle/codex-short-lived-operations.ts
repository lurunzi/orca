import { randomUUID } from 'node:crypto'
import { waitForPromiseWithSignal } from '../../../../shared/abort-signal-reason'
import { parseCliVersion } from '../../../../shared/app-version'
import { requireLegacyAgentSessionAccountHome } from '../../../../shared/agent-session/lifecycle/agent-session-account-home'
import { ORCA_AGENT_SESSION_SPAWN_TOKEN_ENV } from '../../../../shared/agent-session/lifecycle/agent-session-caller-env'
import type { CodexPoolIdentity } from '../../../../shared/agent-session/lifecycle/agent-session-pool-account'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import {
  resolveCodexHomeProcessLockKey,
  withCodexHomeProcessLock
} from '../../../codex-cli/codex-home-process-lock'
import { DashboardAllocationError } from '../../../dashboard-accounts/dashboard-allocation-protocol'
import {
  dashboardCodexChildLaunch,
  prepareDashboardCodexAuthentication,
  type DashboardCodexAuthentication
} from '../../../dashboard-accounts/dashboard-codex-authentication'
import type { DashboardCodexRefreshMailbox } from '../../../dashboard-accounts/dashboard-codex-refresh-mailbox'
import {
  DashboardCodexRefreshSource,
  type DashboardCodexRefreshOperation
} from '../../../dashboard-accounts/dashboard-codex-refresh-protocol'
import { isProviderRecord } from '../../../provider-process/provider-json-record'
import { readProcessStartTimeMs } from '../../../runtime/agent-session/ownership/agent-session-process-identity-probe'
import {
  CodexAppServerTimeoutError,
  runCodexAppServerSession,
  type CodexAppServerInvocation,
  type CodexAppServerRpc
} from '../../app-server/codex-app-server-session'
import type { CodexAppServerSessionRpc } from '../../app-server/codex-app-server-session-hooks'
import { codexProcessIdentity } from '../acquisition/codex-structured-owner-identity'

export type CodexShortLivedOperationOptions = {
  timeoutMs: number
  operation?: DashboardCodexRefreshOperation
  signal?: AbortSignal
  experimentalApi?: boolean
  serializeHome?: boolean
}

export type CodexPreparedShortLivedInvocation = {
  invocation: CodexAppServerInvocation
  cwd: string
}

type CodexShortLivedOperationsDependencies = {
  mailbox: DashboardCodexRefreshMailbox
  hostId?: string
  readProcessStartTime?: (pid: number) => Promise<number | null>
  runSession?: typeof runCodexAppServerSession
}

export class CodexShortLivedOperations {
  private accepting = true
  private readonly operations = new Map<AbortController, Promise<unknown>>()

  constructor(private readonly dependencies: CodexShortLivedOperationsDependencies) {}

  run<T>(
    record: AgentSessionRecord,
    options: CodexShortLivedOperationOptions,
    prepare: (signal: AbortSignal) => Promise<CodexPreparedShortLivedInvocation>,
    body: (rpc: CodexAppServerRpc, cwd: string, identity: CodexPoolIdentity | null) => Promise<T>
  ): Promise<T> {
    const pool = process.env.ORCA_DASHBOARD_INSTANCE_ID !== undefined || !!record.poolAccount
    if (!this.accepting) {
      return Promise.reject(
        pool ? new DashboardAllocationError() : new Error('Codex operations closed')
      )
    }
    const controller = new AbortController()
    const { signal } = controller
    const deadlineAt = Date.now() + options.timeoutMs
    const operationId = randomUUID()
    const spawnToken = randomUUID()
    let active = true
    let authentication: DashboardCodexAuthentication | null = null
    let connection: CodexAppServerSessionRpc | null = null
    const invalidate = (): void => {
      active = false
      authentication?.dispose()
    }
    const onCancel = (): void => controller.abort(options.signal?.reason)
    signal.addEventListener('abort', invalidate, { once: true })
    options.signal?.addEventListener('abort', onCancel, { once: true })
    if (options.signal?.aborted) {
      onCancel()
    }
    const timeoutError = (): Error =>
      new CodexAppServerTimeoutError(`codex app-server operation exceeded ${options.timeoutMs}ms`)
    const timer = setTimeout(() => controller.abort(timeoutError()), options.timeoutMs)
    const check = (): void => {
      if (Date.now() >= deadlineAt && !signal.aborted) {
        controller.abort(timeoutError())
      }
      signal.throwIfAborted()
      if (!active || connection?.closed || connection?.signal.aborted) {
        throw new Error('codex app-server session stopped')
      }
    }
    const current = (): boolean =>
      active &&
      !signal.aborted &&
      connection !== null &&
      !connection.closed &&
      !connection.signal.aborted
    const onTransportEnd = (): void => {
      invalidate()
      controller.abort(connection?.signal.reason)
    }
    const execute = async (): Promise<T> => {
      check()
      const prepared = await waitForPromiseWithSignal(prepare(signal), signal)
      check()
      const { hostId } = this.dependencies
      const operation = options.operation
      if (pool) {
        if (!record.poolAccount || !operation || !hostId) {
          throw new DashboardAllocationError()
        }
        authentication = await waitForPromiseWithSignal(
          prepareDashboardCodexAuthentication(
            current,
            this.dependencies.mailbox,
            {
              signal,
              deadlineAt,
              onRefreshFailure: () => controller.abort(new DashboardAllocationError())
            },
            record.poolAccount
          ),
          signal
        )
        check()
        if (!authentication) {
          throw new DashboardAllocationError()
        }
      }
      const launch = pool ? dashboardCodexChildLaunch(prepared.invocation) : prepared.invocation
      const invocation: CodexAppServerInvocation = {
        ...prepared.invocation,
        env: { ...launch.env, [ORCA_AGENT_SESSION_SPAWN_TOKEN_ENV]: spawnToken },
        envToDelete: launch.envToDelete?.filter(
          (key) => key !== ORCA_AGENT_SESSION_SPAWN_TOKEN_ENV
        ),
        signal,
        timeoutMs: deadlineAt - Date.now(),
        experimentalApi: options.experimentalApi ?? prepared.invocation.experimentalApi
      }
      check()
      return (this.dependencies.runSession ?? runCodexAppServerSession)(
        invocation,
        async () => {
          check()
          if (!connection) {
            throw new Error('codex app-server initialization did not complete')
          }
          const identity = authentication?.authenticatedPoolIdentity() ?? null
          const result = await waitForPromiseWithSignal(
            body(connection, prepared.cwd, identity),
            signal
          )
          check()
          authentication?.authenticatedPoolIdentity()
          return result
        },
        undefined,
        {
          onNotification: (method, params) => {
            authentication?.handleNotification(method, params)
          },
          onServerRequest: (request, rpc) => {
            if (!authentication?.handleRefresh(rpc, request)) {
              rpc.respondWithError(request.id, -32601, 'Method not supported')
            }
          },
          onInitialized: async (rpc, result) => {
            connection = rpc
            rpc.signal.addEventListener('abort', onTransportEnd, { once: true })
            if (rpc.signal.aborted) {
              onTransportEnd()
            }
            check()
            if (!authentication) {
              return
            }
            if (!hostId || !operation) {
              throw new DashboardAllocationError()
            }
            const process = await waitForPromiseWithSignal(
              codexProcessIdentity({ identity: { hostId }, pid: rpc.pid, spawnToken }, (pid) => {
                check()
                return waitForPromiseWithSignal(
                  (this.dependencies.readProcessStartTime ?? readProcessStartTimeMs)(pid),
                  signal
                )
              }),
              signal
            )
            check()
            const version =
              isProviderRecord(result) && typeof result.userAgent === 'string'
                ? parseCliVersion(result.userAgent)
                : null
            await waitForPromiseWithSignal(
              authentication.authenticate(rpc, version, {
                source: DashboardCodexRefreshSource.ShortLivedOperation,
                operation_id: operationId,
                operation,
                source_session_id: record.sessionId,
                process
              }),
              signal
            )
            check()
          }
        }
      )
    }
    const work = Promise.resolve()
      .then(async () => {
        check()
        if (!pool && !options.serializeHome) {
          return execute()
        }
        if (pool && (!record.poolAccount || !options.operation || !this.dependencies.hostId)) {
          throw new DashboardAllocationError()
        }
        const home = requireLegacyAgentSessionAccountHome(record.accountHome).path
        let entered = false
        let enter!: () => void
        const acquired = new Promise<void>((resolve) => {
          enter = resolve
        })
        const locked = withCodexHomeProcessLock(resolveCodexHomeProcessLockKey(home), () => {
          check()
          entered = true
          enter()
          return execute()
        })
        void locked.catch(() => undefined)
        try {
          await waitForPromiseWithSignal(acquired, signal)
          return await locked
        } finally {
          // Cancellation skips the queue, but an entered session must finish its managed cleanup.
          if (entered) {
            await locked.catch(() => undefined)
          }
        }
      })
      .finally(() => {
        invalidate()
        controller.abort()
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onCancel)
        connection?.signal.removeEventListener('abort', onTransportEnd)
        signal.removeEventListener('abort', invalidate)
        this.operations.delete(controller)
      })
      .catch((error: unknown) => {
        if (pool) {
          throw new DashboardAllocationError()
        }
        throw error
      })
    this.operations.set(controller, work)
    return work
  }

  /** Registers pool work that runs before or around `run`, so closeAll also cancels it. */
  track<T>(signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.accepting) {
      return Promise.reject(new DashboardAllocationError())
    }
    const controller = new AbortController()
    const onCancel = (): void => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onCancel, { once: true })
    if (signal?.aborted) {
      onCancel()
    }
    const tracked = Promise.resolve()
      .then(() => waitForPromiseWithSignal(work(controller.signal), controller.signal))
      .finally(() => {
        controller.abort()
        signal?.removeEventListener('abort', onCancel)
        this.operations.delete(controller)
      })
      .catch(() => {
        throw new DashboardAllocationError()
      })
    this.operations.set(controller, tracked)
    return tracked
  }

  async closeAll(): Promise<void> {
    this.accepting = false
    const operations = [...this.operations]
    for (const [controller] of operations) {
      controller.abort(new Error('codex app-server session stopped'))
    }
    await Promise.allSettled(operations.map(([, work]) => work))
  }
}
