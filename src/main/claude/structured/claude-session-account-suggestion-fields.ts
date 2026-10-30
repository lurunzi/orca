import type * as Suggestions from '../claude-prompt-suggestion-store'
import type * as FastMode from '../claude-fast-mode-policy'
import type { AgentSessionFastModeSupport } from '../../../shared/agent-session-wire'

/** Fork: Fast account checks and restart-surviving prompt suggestions. */
export type ClaudeAccountSuggestionDeps = {
  readFastModeAccountSupport?: FastMode.ClaudeFastModeAccountReader
  /** Keeps the last suggestion across app restarts. */
  promptSuggestionStore?: Suggestions.ClaudePromptSuggestionStore
}

export type ClaudeAccountSuggestionSessionFields = {
  fastModeAccountSupport?: AgentSessionFastModeSupport
  readFastModeAccountSupport?: FastMode.ClaudeSessionFastModeAccountReader
  fastModeAccountRead?: Promise<void>
  promptSuggestion?: string | null
  promptSuggestionResultSequence?: number
  promptSuggestionMemory?: Suggestions.ClaudePromptSuggestionMemory
}
