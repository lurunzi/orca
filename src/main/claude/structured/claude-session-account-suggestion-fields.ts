import type * as FastMode from '../claude-fast-mode-policy'
import type { AgentSessionFastModeSupport } from '../../../shared/agent-session/agent-session-wire'

/** Fork: Fast account checks. */
export type ClaudeAccountSuggestionDeps = {
  readFastModeAccountSupport?: FastMode.ClaudeFastModeAccountReader
}

export type ClaudeAccountSuggestionSessionFields = {
  fastModeAccountSupport?: AgentSessionFastModeSupport
  readFastModeAccountSupport?: FastMode.ClaudeSessionFastModeAccountReader
  fastModeAccountRead?: Promise<void>
}
