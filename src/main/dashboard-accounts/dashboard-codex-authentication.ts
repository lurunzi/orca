import { z } from 'zod'
import { waitForPromiseWithSignal } from '../../shared/abort-signal-reason'
import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import type { CodexAppServerServerRequest } from '../codex/app-server/codex-app-server-connection-types'
import type { DashboardCodexLifecycleOptions, DashboardCodexRpc } from './dashboard-codex-rpc'
import { readDashboardCodexAllocationContext } from './dashboard-allocation-reader'
import {
  CodexPoolIdentitySchema,
  type CodexPoolIdentity
} from '../../shared/agent-session/lifecycle/agent-session-pool-account'
import type { DashboardCodexBinding } from './dashboard-codex-adoption-protocol'
import { DashboardCodexRefresh } from './dashboard-codex-refresh'
import type { DashboardCodexRefreshMailbox } from './dashboard-codex-refresh-mailbox'
import type { DashboardCodexRefreshScope } from './dashboard-codex-refresh-protocol'
import {
  DashboardAllocationError,
  type DashboardCodexAllocation
} from './dashboard-allocation-protocol'

const externalMode = 'chatgptAuthTokens'
const timeoutMs = 20000
const authEnvironment = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL'] as const
const LoginResultSchema = z.object({ type: z.literal(externalMode) })
const LoginCompletedSchema = z.object({
  loginId: z.null(),
  success: z.literal(true),
  error: z.null()
})
const AccountUpdatedSchema = z.object({ authMode: z.literal(externalMode) })
const AccountReadSchema = z.object({
  account: z.object({ type: z.literal('chatgpt') }),
  requiresOpenaiAuth: z.literal(true),
  workspaceRouting: z.object({ chatgptAccountId: z.string() })
})

export async function prepareDashboardCodexAuthentication(
  current: () => boolean,
  mailbox: DashboardCodexRefreshMailbox,
  options: DashboardCodexLifecycleOptions = {}
): Promise<DashboardCodexAuthentication | null> {
  if (process.env.ORCA_DASHBOARD_INSTANCE_ID === undefined) {
    return null
  }
  if (process.env.ORCA_DASHBOARD_CODEX_AUTH_EXPERIMENT !== '1') {
    throw new DashboardAllocationError()
  }
  try {
    const signals = options.signal ? [options.signal] : []
    if (options.deadlineAt !== undefined) {
      if (options.deadlineAt <= Date.now()) {
        throw new DashboardAllocationError()
      }
      signals.push(AbortSignal.timeout(Math.max(0, options.deadlineAt - Date.now())))
    }
    const signal = AbortSignal.any(signals)
    if (signal.aborted) {
      throw new DashboardAllocationError()
    }
    // Connection ownership starts after spawn; acquisition rechecks before spawning.
    const context = await waitForPromiseWithSignal(readDashboardCodexAllocationContext(), signal)
    if (
      !context ||
      signal.aborted ||
      (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt)
    ) {
      throw new DashboardAllocationError()
    }
    return new DashboardCodexAuthentication(
      context.allocation,
      current,
      mailbox,
      options,
      context.instanceId
    )
  } catch {
    throw new DashboardAllocationError()
  }
}

export function dashboardCodexChildLaunch(launch: ProviderProcessLaunch): ProviderProcessLaunch {
  const env = { ...launch.env }
  for (const key of authEnvironment) {
    delete env[key]
  }
  return {
    ...launch,
    env,
    envToDelete: [...new Set([...(launch.envToDelete ?? []), ...authEnvironment])]
  }
}

export class DashboardCodexAuthentication {
  private observing = false
  private completed = false
  private updated = false
  private authenticated = false
  private failed = false
  private finish!: (ready: boolean) => void
  private readonly ready = new Promise<boolean>((resolve) => {
    this.finish = resolve
  })
  private readonly refresh: DashboardCodexRefresh
  private readonly abort = new AbortController()
  private readonly onAbort = () => this.dispose()
  private deadlineTimer?: ReturnType<typeof setTimeout>
  private connection: DashboardCodexRpc | null = null
  private allocation: DashboardCodexAllocation | null
  private readonly poolIdentity: CodexPoolIdentity | null
  constructor(
    allocation: DashboardCodexAllocation,
    private readonly current: () => boolean,
    mailbox: DashboardCodexRefreshMailbox,
    private readonly options: DashboardCodexLifecycleOptions = {},
    instanceId?: string
  ) {
    this.poolIdentity =
      instanceId === undefined
        ? null
        : CodexPoolIdentitySchema.parse({
            instanceId,
            provider: allocation.provider,
            accountId: allocation.account_id,
            bindingRevision: allocation.binding_revision,
            credentialVersion: allocation.credential_version
          })
    this.allocation = allocation
    this.refresh = new DashboardCodexRefresh(allocation, current, () => this.reject(), mailbox, {
      signal: this.abort.signal,
      deadlineAt: options.deadlineAt
    })
    options.signal?.addEventListener('abort', this.onAbort, { once: true })
    if (
      options.signal?.aborted ||
      (options.deadlineAt !== undefined && options.deadlineAt <= Date.now())
    ) {
      this.dispose()
    } else if (options.deadlineAt !== undefined) {
      this.deadlineTimer = setTimeout(this.onAbort, options.deadlineAt - Date.now())
    }
  }

  dispose(): void {
    if (this.failed) {
      return
    }
    this.failed = true
    this.allocation = null
    this.finish(false)
    this.refresh.dispose()
    this.abort.abort(new DashboardAllocationError())
    this.options.signal?.removeEventListener('abort', this.onAbort)
    clearTimeout(this.deadlineTimer)
  }

  handleNotification(method: string, params: unknown): boolean {
    if (!this.observing) {
      return false
    }
    if (this.failed || this.abort.signal.aborted || this.connection?.closed || !this.current()) {
      this.dispose()
      return true
    }
    if (method === 'account/login/completed') {
      this.completed = LoginCompletedSchema.safeParse(params).success
      if (!this.completed) {
        this.reject()
      }
    } else if (method === 'account/updated') {
      this.updated = AccountUpdatedSchema.safeParse(params).success
      if (!this.updated) {
        this.reject()
      }
    } else {
      return false
    }
    if (this.completed && this.updated) {
      this.finish(true)
    }
    return true
  }

  handleRefresh(
    connection: DashboardCodexRpc | null,
    request: CodexAppServerServerRequest
  ): boolean {
    return this.refresh.handle(connection, request)
  }

  authenticatedPoolIdentity(): CodexPoolIdentity {
    this.assertCurrent()
    if (!this.authenticated || !this.poolIdentity) {
      throw new DashboardAllocationError()
    }
    return { ...this.poolIdentity }
  }

  private reject(): void {
    if (!this.authenticated) {
      this.dispose()
    }
  }

  private assertCurrent(): void {
    if (this.failed || this.abort.signal.aborted || this.connection?.closed || !this.current()) {
      throw new DashboardAllocationError()
    }
    if (this.options.deadlineAt !== undefined && Date.now() >= this.options.deadlineAt) {
      throw new DashboardAllocationError()
    }
  }

  private remainingTimeout(): number {
    this.assertCurrent()
    const remaining = Math.min(timeoutMs, (this.options.deadlineAt ?? Infinity) - Date.now())
    if (remaining <= 0) {
      throw new DashboardAllocationError()
    }
    return remaining
  }

  async authenticate(
    connection: DashboardCodexRpc,
    version: string | null,
    scope: DashboardCodexRefreshScope
  ): Promise<DashboardCodexBinding> {
    const allocation = this.allocation
    this.allocation = null
    try {
      this.connection = connection
      this.assertCurrent()
      if (!allocation || version !== '0.166.0') {
        throw new DashboardAllocationError()
      }
      this.refresh.activate(connection, scope)
      this.observing = true
      const loginTimeout = this.remainingTimeout()
      const login = await waitForPromiseWithSignal(
        connection.request(
          'account/login/start',
          {
            type: externalMode,
            accessToken: allocation.access_token,
            chatgptAccountId: allocation.chatgpt_account_id,
            chatgptPlanType: null
          },
          { timeoutMs: loginTimeout }
        ),
        this.abort.signal
      )
      this.assertCurrent()
      if (!LoginResultSchema.safeParse(login).success) {
        throw new DashboardAllocationError()
      }
      const ready = await waitForPromiseWithSignal(
        this.ready,
        AbortSignal.any([
          this.abort.signal,
          AbortSignal.timeout(Math.max(0, this.remainingTimeout()))
        ])
      )
      this.assertCurrent()
      if (!ready) {
        throw new DashboardAllocationError()
      }
      const accountTimeout = this.remainingTimeout()
      const account = AccountReadSchema.safeParse(
        await waitForPromiseWithSignal(
          connection.request(
            'account/read',
            { refreshToken: false },
            { timeoutMs: accountTimeout }
          ),
          this.abort.signal
        )
      )
      this.assertCurrent()
      if (
        !account.success ||
        this.failed ||
        account.data.workspaceRouting.chatgptAccountId !== allocation.chatgpt_account_id
      ) {
        throw new DashboardAllocationError()
      }
      this.authenticated = true
      return {
        account_id: allocation.account_id,
        binding_revision: allocation.binding_revision,
        credential_version: allocation.credential_version
      }
    } catch {
      this.dispose()
      throw new DashboardAllocationError()
    } finally {
      this.observing = false
    }
  }
}
