import {
  DashboardAllocationErrorCode,
  DashboardAllocationStatusSchema
} from '../../main/dashboard-accounts/dashboard-allocation-protocol'
import { DashboardCodexProcessesResponseSchema } from '../../main/dashboard-accounts/dashboard-codex-adoption-protocol'
import { DashboardCodexRefreshesResponseSchema } from '../../main/dashboard-accounts/dashboard-codex-refresh-protocol'
import { DashboardClaudeLaunchesResponseSchema } from '../../main/dashboard-accounts/dashboard-claude-launch-protocol'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { RuntimeClient, RuntimeClientError } from '../runtime-client'

import { requireLocalDashboardRuntime } from './dashboard-local-runtime'
import { restartDashboardAgent } from './dashboard-agent-restart'

async function queryLocalDashboard(
  { flags }: HandlerContext,
  read: (client: RuntimeClient) => Promise<unknown>
): Promise<void> {
  const userData = requireLocalDashboardRuntime(flags, ['json', 'help'])
  try {
    console.log(JSON.stringify(await read(new RuntimeClient(userData, 10_000, null, null))))
  } catch {
    throw new RuntimeClientError(
      DashboardAllocationErrorCode.Unavailable,
      DashboardAllocationErrorCode.Unavailable
    )
  }
}

export const DASHBOARD_ACCOUNT_HANDLERS: Record<string, CommandHandler> = {
  'dashboard-accounts restart': restartDashboardAgent,
  'dashboard-accounts status': async (context) =>
    queryLocalDashboard(context, async (client) => {
      const response = await client.call<unknown>('dashboard.accounts.status', {})
      return DashboardAllocationStatusSchema.parse(response.result)
    }),
  'dashboard-accounts codex-processes': async (context) =>
    queryLocalDashboard(context, async (client) => {
      const response = await client.call<unknown>('dashboard.accounts.codexProcesses', {})
      return DashboardCodexProcessesResponseSchema.parse(response.result)
    }),
  'dashboard-accounts codex-refreshes': async (context) =>
    queryLocalDashboard(context, async (client) => {
      const response = await client.call<unknown>('dashboard.accounts.codexRefreshes', {})
      return DashboardCodexRefreshesResponseSchema.parse(response.result)
    }),
  'dashboard-accounts claude-launches': async (context) =>
    queryLocalDashboard(context, async (client) => {
      const response = await client.call<unknown>('dashboard.accounts.claudeLaunches', {})
      return DashboardClaudeLaunchesResponseSchema.parse(response.result)
    })
}
