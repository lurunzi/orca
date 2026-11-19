import type { TuiAgent } from '../catalog/tui-agent'

type AgentEnv = Readonly<Record<string, string>>

// Why: a background updater starts detached, so on Windows it opens a visible console window.
const AGENT_AUTO_UPDATE_SUPPRESSION_ENV: Readonly<Record<string, AgentEnv>> = {
  claude: { DISABLE_AUTOUPDATER: '1' },
  'claude-agent-teams': { DISABLE_AUTOUPDATER: '1' },
  opencode: { OPENCODE_DISABLE_AUTOUPDATE: 'true' },
  opencode2: { OPENCODE_DISABLE_AUTOUPDATE: 'true' },
  antigravity: { AGY_CLI_DISABLE_AUTO_UPDATE: 'true' },
  grok: { GROK_DISABLE_AUTOUPDATER: '1' },
  pi: { PI_SKIP_VERSION_CHECK: '1' },
  kimi: { KIMI_CODE_NO_AUTO_UPDATE: '1', KIMI_CLI_NO_AUTO_UPDATE: '1' }
} satisfies Partial<Record<TuiAgent, AgentEnv>>

export function agentAutoUpdateSuppressionEnv(agent: string): AgentEnv | undefined {
  return Object.hasOwn(AGENT_AUTO_UPDATE_SUPPRESSION_ENV, agent)
    ? AGENT_AUTO_UPDATE_SUPPRESSION_ENV[agent]
    : undefined
}

/** Every agent's suppression, for background launches that do not know which agent they run. */
export const ANY_AGENT_AUTO_UPDATE_SUPPRESSION_ENV: AgentEnv = Object.assign(
  {},
  ...Object.values(AGENT_AUTO_UPDATE_SUPPRESSION_ENV)
)
