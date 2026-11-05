import { z } from 'zod'
import {
  DashboardAgentRestartCode as Code,
  DashboardAgentRestartParamsSchema,
  DashboardAgentRestartResponseSchema,
  DASHBOARD_AGENT_RESTART_LIMIT_BYTES,
  DASHBOARD_AGENT_RESTART_TIMEOUT_MS,
  type DashboardAgentRestartParams
} from '../../main/dashboard-accounts/dashboard-agent-restart-protocol'
import { DashboardAllocationErrorCode } from '../../main/dashboard-accounts/dashboard-allocation-protocol'
import type { HandlerContext } from '../dispatch'
import { RuntimeClient, RuntimeClientError, RuntimeRpcFailureError } from '../runtime-client'
import { requireLocalDashboardRuntime } from './dashboard-local-runtime'

const PREFLIGHT_TIMEOUT_MS = 10_000

function parseRequest(flags: HandlerContext['flags']): {
  userData: string
  params: DashboardAgentRestartParams
} {
  try {
    const userData = requireLocalDashboardRuntime(flags, ['help', 'json', 'request-json'])
    const json = flags.get('request-json')
    if (
      typeof json !== 'string' ||
      Buffer.byteLength(json, 'utf8') > DASHBOARD_AGENT_RESTART_LIMIT_BYTES
    ) {
      throw new Error(Code.InvalidRequest)
    }
    return { userData, params: DashboardAgentRestartParamsSchema.parse(JSON.parse(json)) }
  } catch {
    throw new RuntimeClientError(Code.InvalidRequest, Code.InvalidRequest)
  }
}
function failureCode(error: unknown): Code {
  if (error instanceof RuntimeRpcFailureError) {
    const parsed = z.enum(Code).safeParse(error.response.error.message)
    if (parsed.success) {
      return parsed.data
    }
    if (error.response.error.message === DashboardAllocationErrorCode.Unavailable) {
      return Code.Unavailable
    }
  }
  return Code.OutcomeUnknown
}
export async function restartDashboardAgent({ flags }: HandlerContext): Promise<void> {
  const { userData, params } = parseRequest(flags)
  try {
    const client = new RuntimeClient(userData, PREFLIGHT_TIMEOUT_MS, null, null)
    const response = await client.call<unknown>('dashboard.accounts.restartAgent', params, {
      timeoutMs: DASHBOARD_AGENT_RESTART_TIMEOUT_MS - PREFLIGHT_TIMEOUT_MS
    })
    const report = DashboardAgentRestartResponseSchema.parse(response.result)
    if (
      report.instance_id !== params.instance_id ||
      report.runtime_id !== params.runtime_id ||
      report.result.provider !== params.target.provider ||
      report.result.session_id !== params.target.session_id ||
      report.result.fence <= params.target.fence ||
      report.result.acquisition_generation === params.target.acquisition_generation
    ) {
      throw new Error(Code.InvalidRequest)
    }
    console.log(JSON.stringify(report))
  } catch (error) {
    const code = failureCode(error)
    throw new RuntimeClientError(code, code)
  }
}
