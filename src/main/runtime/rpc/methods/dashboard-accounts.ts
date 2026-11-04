import { z } from 'zod'
import { defineMethod, type RpcContext } from '../core'
import {
  DashboardAllocationError,
  DashboardToolProvider
} from '../../../dashboard-accounts/dashboard-allocation-protocol'
import { DashboardCodexProcessesResponseSchema } from '../../../dashboard-accounts/dashboard-codex-adoption-protocol'
import { DashboardCodexRefreshesResponseSchema } from '../../../dashboard-accounts/dashboard-codex-refresh-protocol'
import { readDashboardAllocationStatus } from '../../../dashboard-accounts/dashboard-allocation-status'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'

function requireLocalCaller({
  caller,
  clientKind
}: Pick<RpcContext, 'caller' | 'clientKind'>): void {
  if (caller?.kind !== 'local-cli' || clientKind !== undefined) {
    throw new DashboardAllocationError()
  }
}

function codexReportContext(context: RpcContext) {
  const instanceId = process.env.ORCA_DASHBOARD_INSTANCE_ID
  if (process.platform !== 'linux' || !instanceId) {
    throw new DashboardAllocationError()
  }
  return {
    common: {
      schema_version: 1,
      instance_id: instanceId,
      runtime_id: context.runtime.getRuntimeId()
    },
    adapter: getStructuredAgentSessionHost()?.deps.agents.registration(DashboardToolProvider.Codex)
      ?.adapter
  }
}

export const DASHBOARD_ACCOUNT_METHODS = [
  defineMethod({
    name: 'dashboard.accounts.status',
    permission: 'accounts-admin',
    params: z.strictObject({}),
    handler: async (_, context) => {
      requireLocalCaller(context)
      return readDashboardAllocationStatus()
    }
  }),
  defineMethod({
    name: 'dashboard.accounts.codexProcesses',
    permission: 'accounts-admin',
    params: z.strictObject({}),
    handler: async (_, context) => {
      requireLocalCaller(context)
      try {
        const { common, adapter } = codexReportContext(context)
        const state = adapter?.readDashboardCodexProcesses?.()
        return DashboardCodexProcessesResponseSchema.parse({
          ...common,
          ...(state === undefined ? { supported: false } : { supported: true, ...state })
        })
      } catch {
        throw new DashboardAllocationError()
      }
    }
  }),
  defineMethod({
    name: 'dashboard.accounts.codexRefreshes',
    permission: 'accounts-admin',
    params: z.strictObject({}),
    handler: async (_, context) => {
      requireLocalCaller(context)
      try {
        const { common, adapter } = codexReportContext(context)
        const state = adapter?.readDashboardCodexRefreshes?.()
        return DashboardCodexRefreshesResponseSchema.parse({
          ...common,
          ...(state === undefined ? { supported: false } : { supported: true, ...state })
        })
      } catch {
        throw new DashboardAllocationError()
      }
    }
  })
] as const
