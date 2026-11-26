import { applyClaudeEnvPatch } from '../claude-accounts/runtime-auth/environment'
import type { DashboardClaudeAllocation } from './dashboard-allocation-protocol'
import { readDashboardClaudeAllocation } from './dashboard-allocation-reader'
import { waitForDashboardAllocation } from './dashboard-allocation-wait'
import type { DashboardClaudeLaunchBinding } from './dashboard-claude-launch-protocol'

export const DASHBOARD_CLAUDE_ENV_TO_DELETE: readonly string[] = [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY'
]
export function dashboardClaudeEnvironment(
  source: Record<string, string>,
  allocation: DashboardClaudeAllocation
): Record<string, string> {
  const env = applyClaudeEnvPatch({ ...source }, {}, { stripAuthEnv: true })
  for (const key of DASHBOARD_CLAUDE_ENV_TO_DELETE) {
    delete env[key]
  }
  env.CLAUDE_CODE_OAUTH_TOKEN = allocation.access_token
  return env
}

type DashboardClaudePreparedLaunch = {
  launch: { dashboardBinding?: DashboardClaudeLaunchBinding }
  env: Record<string, string>
  inheritedEnvToDelete: readonly string[]
}

export async function prepareDashboardClaudeLaunch(
  source: Record<string, string>
): Promise<DashboardClaudePreparedLaunch> {
  const allocation = await waitForDashboardAllocation(readDashboardClaudeAllocation)
  return {
    launch: allocation
      ? {
          dashboardBinding: {
            account_id: allocation.account_id,
            binding_revision: allocation.binding_revision,
            credential_version: allocation.credential_version
          }
        }
      : {},
    env: allocation ? dashboardClaudeEnvironment(source, allocation) : source,
    inheritedEnvToDelete: allocation ? DASHBOARD_CLAUDE_ENV_TO_DELETE : []
  }
}

/** Fork: adds a dashboard-pooled account's binding and env to a built Claude launch part. */
export async function withDashboardClaudeLaunch<
  T extends { launch: object; env: Record<string, string>; inheritedEnvToDelete: readonly string[] }
>(part: T): Promise<T> {
  const dashboard = await prepareDashboardClaudeLaunch(part.env)
  return {
    ...part,
    launch: { ...part.launch, ...dashboard.launch },
    env: dashboard.env,
    inheritedEnvToDelete: [...part.inheritedEnvToDelete, ...dashboard.inheritedEnvToDelete]
  }
}
