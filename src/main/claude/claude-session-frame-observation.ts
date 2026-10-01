import { observeClaudePromptSuggestion } from './claude-prompt-suggestion'
import type { ClaudeSession, ClaudeStructuredSessionEvent } from './claude-structured-session-state'

/** Per-frame session bookkeeping that runs before the frame is translated. */
export function observeClaudeSessionFrame(
  session: ClaudeSession | null,
  event: ClaudeStructuredSessionEvent
): void {
  observeClaudePromptSuggestion(session, event)
  if (event.type === 'ended') {
    session?.childWork.clear()
  } else if (event.type === 'message') {
    session?.childWork.observe(event.message)
  }
}
