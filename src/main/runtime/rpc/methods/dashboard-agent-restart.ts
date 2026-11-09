import { z } from 'zod'
import { defineMethod } from '../core'
import { requireLocalDashboardCaller } from './dashboard-account-local-caller'
import {
  DashboardAgentRestartCode as Code,
  DashboardAgentRestartError,
  DashboardAgentRestartParamsSchema,
  DashboardAgentRestartResponseSchema
} from '../../../dashboard-accounts/dashboard-agent-restart-protocol'
import { DASHBOARD_AGENT_RESTART_SOURCES } from '../../../dashboard-accounts/dashboard-agent-restart-source'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/host/structured-agent-session-registry'

export const DASHBOARD_AGENT_RESTART_METHOD = defineMethod({
  name: 'dashboard.accounts.restartAgent',
  permission: 'accounts-admin',
  params: z.unknown().transform((input, context) => {
    const parsed = DashboardAgentRestartParamsSchema.safeParse(input)
    if (!parsed.success) {
      context.addIssue({ code: 'custom', message: Code.InvalidRequest })
      return z.NEVER
    }
    return parsed.data
  }),
  handler: async (input, context) => {
    requireLocalDashboardCaller(context)
    try {
      const parsed = DashboardAgentRestartParamsSchema.safeParse(input)
      if (!parsed.success) {
        throw new DashboardAgentRestartError(Code.InvalidRequest)
      }
      const params = parsed.data
      const instanceId = process.env.ORCA_DASHBOARD_INSTANCE_ID
      if (process.platform !== 'linux' || !instanceId) {
        throw new DashboardAgentRestartError(Code.Unavailable)
      }
      const runtimeId = context.runtime.getRuntimeId()
      if (instanceId !== params.instance_id || runtimeId !== params.runtime_id) {
        throw new DashboardAgentRestartError(Code.TargetChanged)
      }
      const host = getStructuredAgentSessionHost()
      if (!host) {
        throw new DashboardAgentRestartError(Code.Unavailable)
      }
      DASHBOARD_AGENT_RESTART_SOURCES[params.target.provider].require(host, params.target)
      const result = await host.restartAgentForCredentials(params.target)
      return DashboardAgentRestartResponseSchema.parse({
        schema_version: 1,
        instance_id: instanceId,
        runtime_id: runtimeId,
        result
      })
    } catch (error) {
      throw new DashboardAgentRestartError(
        error instanceof DashboardAgentRestartError ? error.code : Code.Failed
      )
    }
  }
})
