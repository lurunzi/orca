import type { AgentType } from '../../../../shared/agent-status-types'
import type { CatalogModel } from '../../../../shared/agent-session-option-catalog'
import type { SessionOptionValue } from '../../../../shared/native-chat-session-options'
import { readClaudeSessionOptionsFromTerminalScreen } from './claude-terminal-session-options'
import { readAntigravityTerminalSessionOptions } from '../../../../shared/antigravity-terminal-session-options'

export function readAgentTerminalSessionOptions(
  agent: AgentType,
  screen: string | null | undefined,
  models?: readonly CatalogModel[]
): Record<string, SessionOptionValue> | null {
  if (agent === 'claude') {
    return readClaudeSessionOptionsFromTerminalScreen(screen, models)
  }
  return agent === 'antigravity' ? readAntigravityTerminalSessionOptions(screen, models) : null
}
