import { z } from 'zod'
import { defineMethod, type RpcContext } from '../core'
import {
  DashboardAllocationError,
  DashboardToolProvider
} from '../../../dashboard-accounts/dashboard-allocation-protocol'
import { DashboardCodexProcessesResponseSchema } from '../../../dashboard-accounts/dashboard-codex-adoption-protocol'
import { DashboardCodexRefreshesResponseSchema } from '../../../dashboard-accounts/dashboard-codex-refresh-protocol'
import { DashboardClaudeLaunchesResponseSchema } from '../../../dashboard-accounts/dashboard-claude-launch-protocol'
import { readDashboardAllocationStatus } from '../../../dashboard-accounts/dashboard-allocation-status'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/host/structured-agent-session-registry'

import { requireLocalDashboardCaller } from './dashboard-account-local-caller'
import { DASHBOARD_AGENT_RESTART_METHOD } from './dashboard-agent-restart'

function reportContext(context: RpcContext, agent: string) {
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
    adapter: getStructuredAgentSessionHost()?.deps.agents.registration(agent)?.adapter
  }
}

export const DASHBOARD_ACCOUNT_METHODS = [
  defineMethod({
    name: 'dashboard.accounts.status',
    permission: 'accounts-admin',
    params: z.strictObject({}),
    handler: async (_, context) => {
      requireLocalDashboardCaller(context)
      return readDashboardAllocationStatus()
    }
  }),
  defineMethod({
    name: 'dashboard.accounts.codexProcesses',
    permission: 'accounts-admin',
    params: z.strictObject({}),
    handler: async (_, context) => {
      requireLocalDashboardCaller(context)
      try {
        const { common, adapter } = reportContext(context, DashboardToolProvider.Codex)
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
      requireLocalDashboardCaller(context)
      try {
        const { common, adapter } = reportContext(context, DashboardToolProvider.Codex)
        const state = adapter?.readDashboardCodexRefreshes?.()
        return DashboardCodexRefreshesResponseSchema.parse({
          ...common,
          schema_version: 2,
          ...(state === undefined ? { supported: false } : { supported: true, ...state })
        })
      } catch {
        throw new DashboardAllocationError()
      }
    }
  }),
  defineMethod({
    name: 'dashboard.accounts.claudeLaunches',
    permission: 'accounts-admin',
    params: z.strictObject({}),
    handler: async (_, context) => {
      requireLocalDashboardCaller(context)
      try {
        const { common, adapter } = reportContext(context, 'claude')
        const state = adapter?.readDashboardClaudeLaunches?.()
        return DashboardClaudeLaunchesResponseSchema.parse({
          ...common,
          ...(state === undefined ? { supported: false } : { supported: true, ...state })
        })
      } catch {
        throw new DashboardAllocationError()
      }
    }
  }),
  DASHBOARD_AGENT_RESTART_METHOD
] as const
