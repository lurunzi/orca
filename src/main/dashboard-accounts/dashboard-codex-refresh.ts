import { z } from 'zod'
import { delayUnlessAborted } from '../../shared/abort-aware-delay'
import { throwIfSignalAborted, waitForPromiseWithSignal } from '../../shared/abort-signal-reason'
import type { CodexAppServerServerRequest } from '../codex/app-server/codex-app-server-connection-types'
import type { DashboardCodexLifecycleOptions, DashboardCodexRpc } from './dashboard-codex-rpc'
import { readDashboardCodexAllocation } from './dashboard-allocation-reader'
import type { DashboardCodexRefreshMailbox } from './dashboard-codex-refresh-mailbox'
import type { DashboardCodexRefreshScope } from './dashboard-codex-refresh-protocol'
import {
  DashboardAllocationError,
  type DashboardCodexAllocation
} from './dashboard-allocation-protocol'

const RefreshParamsSchema = z.strictObject({
  reason: z.literal('unauthorized'),
  previousAccountId: z.string().nullable().optional()
})

export class DashboardCodexRefresh {
  private readonly accountId: string
  private readonly revision: number
  private readonly workspace: string
  private version: number
  private connection: DashboardCodexRpc | null = null
  private scope: DashboardCodexRefreshScope | null = null
  private pending = false
  private disposed = false
  private cancelPending?: () => void
  private readonly onAbort = () => this.dispose()

  constructor(
    allocation: DashboardCodexAllocation,
    private readonly current: () => boolean,
    private readonly failed: () => void,
    private readonly mailbox: DashboardCodexRefreshMailbox,
    private readonly options: DashboardCodexLifecycleOptions = {}
  ) {
    this.accountId = allocation.account_id
    this.revision = allocation.binding_revision
    this.workspace = allocation.chatgpt_account_id
    this.version = allocation.credential_version
    options.signal?.addEventListener('abort', this.onAbort, { once: true })
    if (options.signal?.aborted) {
      this.dispose()
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.connection = null
    this.scope = null
    this.cancelPending?.()
    this.options.signal?.removeEventListener('abort', this.onAbort)
  }

  activate(connection: DashboardCodexRpc, scope: DashboardCodexRefreshScope): void {
    if (this.disposed) {
      throw new DashboardAllocationError()
    }
    this.connection = connection
    this.scope = { ...scope, process: { ...scope.process } }
  }

  handle(connection: DashboardCodexRpc | null, request: CodexAppServerServerRequest): boolean {
    if (request.method !== 'account/chatgptAuthTokens/refresh' || !connection) {
      return false
    }
    if (this.disposed || this.options.signal?.aborted) {
      return true
    }
    if (this.pending) {
      this.reject(connection, request.id)
      return true
    }
    const params = RefreshParamsSchema.safeParse(request.params)
    if (
      !params.success ||
      (params.data.previousAccountId != null && params.data.previousAccountId !== this.workspace)
    ) {
      this.reject(connection, request.id)
      this.failed()
      return true
    }
    this.pending = true
    void this.reply(connection, request.id)
      .catch(() => {
        if (!this.disposed) {
          this.reject(connection, request.id)
          this.failed()
        }
      })
      .finally(() => {
        this.pending = false
      })
    return true
  }

  private async reply(connection: DashboardCodexRpc, id: string | number): Promise<void> {
    const abort = new AbortController()
    const deadline = Math.min(Date.now() + 9000, this.options.deadlineAt ?? Infinity)
    const timer = setTimeout(
      () => abort.abort(new DashboardAllocationError()),
      Math.max(0, deadline - Date.now())
    )
    let unregister: (() => void) | undefined
    this.cancelPending = () => {
      unregister?.()
      clearTimeout(timer)
      abort.abort(new DashboardAllocationError())
    }
    try {
      this.assertCurrent(connection, abort.signal, deadline)
      if (!this.scope) {
        throw new DashboardAllocationError()
      }
      unregister = this.mailbox.register(
        this.scope,
        {
          account_id: this.accountId,
          binding_revision: this.revision,
          credential_version: this.version
        },
        deadline,
        () =>
          !this.disposed &&
          !abort.signal.aborted &&
          connection === this.connection &&
          !connection.closed &&
          this.current()
      )
      for (;;) {
        this.assertCurrent(connection, abort.signal, deadline)
        const allocation = await waitForPromiseWithSignal(
          readDashboardCodexAllocation(),
          abort.signal
        )
        this.assertCurrent(connection, abort.signal, deadline)
        if (
          !allocation ||
          allocation.account_id !== this.accountId ||
          allocation.binding_revision !== this.revision ||
          allocation.chatgpt_account_id !== this.workspace ||
          allocation.credential_version < this.version
        ) {
          throw new DashboardAllocationError()
        }
        if (allocation.credential_version > this.version) {
          connection.respond(id, {
            accessToken: allocation.access_token,
            chatgptAccountId: allocation.chatgpt_account_id,
            chatgptPlanType: null
          })
          this.version = allocation.credential_version
          return
        }
        await delayUnlessAborted(250, abort.signal)
        this.assertCurrent(connection, abort.signal, deadline)
      }
    } finally {
      unregister?.()
      clearTimeout(timer)
      this.cancelPending = undefined
    }
  }

  private assertCurrent(
    connection: DashboardCodexRpc,
    signal: AbortSignal,
    deadline: number
  ): void {
    throwIfSignalAborted(signal)
    if (
      this.disposed ||
      this.options.signal?.aborted ||
      Date.now() >= deadline ||
      connection !== this.connection ||
      connection.closed ||
      !this.current()
    ) {
      throw new DashboardAllocationError()
    }
  }

  private reject(connection: DashboardCodexRpc, id: string | number): void {
    if (this.disposed || this.options.signal?.aborted || connection.closed) {
      return
    }
    try {
      connection.respondWithError(id, -32001, 'Dashboard credential refresh is not available')
    } catch {
      // Teardown can close the transport before the fixed error reply.
    }
  }
}
