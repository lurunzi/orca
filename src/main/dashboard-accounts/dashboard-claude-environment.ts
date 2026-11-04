import { applyClaudeEnvPatch } from '../claude-accounts/environment'
import type { DashboardClaudeAllocation } from './dashboard-allocation-protocol'

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
