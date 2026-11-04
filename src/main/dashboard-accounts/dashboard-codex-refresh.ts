import { z } from 'zod'
import { delayUnlessAborted } from '../../shared/abort-aware-delay'
import { throwIfSignalAborted, waitForPromiseWithSignal } from '../../shared/abort-signal-reason'
import type {
  CodexAppServerConnection,
  CodexAppServerServerRequest
} from '../codex/app-server/codex-app-server-connection-types'
import { readDashboardCodexAllocation } from './dashboard-allocation-reader'
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
  private connection: CodexAppServerConnection | null = null
  private pending = false

  constructor(
    allocation: DashboardCodexAllocation,
    private readonly current: () => boolean,
    private readonly failed: () => void
  ) {
    this.accountId = allocation.account_id
    this.revision = allocation.binding_revision
    this.workspace = allocation.chatgpt_account_id
    this.version = allocation.credential_version
  }

  activate(connection: CodexAppServerConnection): void {
    this.connection = connection
  }

  handle(
    connection: CodexAppServerConnection | null,
    request: CodexAppServerServerRequest
  ): boolean {
    if (request.method !== 'account/chatgptAuthTokens/refresh' || !connection) {
      return false
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
      this.failed()
      this.reject(connection, request.id)
      return true
    }
    this.pending = true
    void this.reply(connection, request.id)
      .catch(() => {
        this.failed()
        this.reject(connection, request.id)
      })
      .finally(() => {
        this.pending = false
      })
    return true
  }

  private async reply(connection: CodexAppServerConnection, id: string | number): Promise<void> {
    const abort = new AbortController()
    const deadline = Date.now() + 9000
    const timer = setTimeout(() => abort.abort(), 9000)
    try {
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
      }
    } finally {
      clearTimeout(timer)
    }
  }

  private assertCurrent(
    connection: CodexAppServerConnection,
    signal: AbortSignal,
    deadline: number
  ): void {
    throwIfSignalAborted(signal)
    if (
      Date.now() >= deadline ||
      connection !== this.connection ||
      connection.closed ||
      !this.current()
    ) {
      throw new DashboardAllocationError()
    }
  }

  private reject(connection: CodexAppServerConnection, id: string | number): void {
    try {
      connection.respondWithError(id, -32001, 'Dashboard credential refresh is not available')
    } catch {
      // Teardown can close the transport before the fixed error reply.
    }
  }
}
