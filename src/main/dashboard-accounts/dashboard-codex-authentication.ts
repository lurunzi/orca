import { z } from 'zod'
import { waitForPromiseWithSignal } from '../../shared/abort-signal-reason'
import type { ProviderProcessLaunch } from '../provider-process/provider-process-launch'
import type {
  CodexAppServerConnection,
  CodexAppServerServerRequest
} from '../codex/app-server/codex-app-server-connection-types'
import { readDashboardCodexAllocation } from './dashboard-allocation-reader'
import type { DashboardCodexBinding } from './dashboard-codex-adoption-protocol'
import { DashboardCodexRefresh } from './dashboard-codex-refresh'
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
  current: () => boolean
): Promise<DashboardCodexAuthentication | null> {
  if (process.env.ORCA_DASHBOARD_INSTANCE_ID === undefined) {
    return null
  }
  if (process.env.ORCA_DASHBOARD_CODEX_AUTH_EXPERIMENT !== '1') {
    throw new DashboardAllocationError()
  }
  const allocation = await readDashboardCodexAllocation()
  if (!allocation) {
    throw new DashboardAllocationError()
  }
  return new DashboardCodexAuthentication(allocation, current)
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
  private failed = false
  private finish!: (ready: boolean) => void
  private readonly ready = new Promise<boolean>((resolve) => {
    this.finish = resolve
  })
  private readonly refresh: DashboardCodexRefresh
  private allocation: DashboardCodexAllocation | null
  constructor(allocation: DashboardCodexAllocation, current: () => boolean) {
    this.allocation = allocation
    this.refresh = new DashboardCodexRefresh(allocation, current, () => this.reject())
  }

  handleNotification(method: string, params: unknown): boolean {
    if (!this.observing) {
      return false
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
    connection: CodexAppServerConnection | null,
    request: CodexAppServerServerRequest
  ): boolean {
    return this.refresh.handle(connection, request)
  }

  private reject(): void {
    this.failed = true
    this.finish(false)
  }

  async authenticate(
    connection: CodexAppServerConnection,
    version: string | null
  ): Promise<DashboardCodexBinding> {
    const allocation = this.allocation
    this.allocation = null
    try {
      if (!allocation || version !== '0.166.0') {
        throw new DashboardAllocationError()
      }
      this.refresh.activate(connection)
      this.observing = true
      const login = await connection.request(
        'account/login/start',
        {
          type: externalMode,
          accessToken: allocation.access_token,
          chatgptAccountId: allocation.chatgpt_account_id,
          chatgptPlanType: null
        },
        { timeoutMs }
      )
      if (!LoginResultSchema.safeParse(login).success) {
        throw new DashboardAllocationError()
      }
      if (!(await waitForPromiseWithSignal(this.ready, AbortSignal.timeout(timeoutMs)))) {
        throw new DashboardAllocationError()
      }
      const account = AccountReadSchema.safeParse(
        await connection.request('account/read', { refreshToken: false }, { timeoutMs })
      )
      if (
        !account.success ||
        this.failed ||
        account.data.workspaceRouting.chatgptAccountId !== allocation.chatgpt_account_id
      ) {
        throw new DashboardAllocationError()
      }
      return {
        account_id: allocation.account_id,
        binding_revision: allocation.binding_revision,
        credential_version: allocation.credential_version
      }
    } catch {
      throw new DashboardAllocationError()
    } finally {
      this.observing = false
    }
  }
}
