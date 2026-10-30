import type { ClaudePromptSuggestionMemory } from './claude-prompt-suggestion-store'
import type { ClaudeSession, ClaudeStructuredSessionEvent } from './structured/claude-structured-session-state'

const pendingWrites = new WeakMap<ClaudeSession, object>()

/** `retire` drops the saved copy too; an ended session keeps it for the next resume. */
export function clearClaudePromptSuggestion(session: ClaudeSession, retire = true): void {
  session.promptSuggestionResultSequence = undefined
  if (retire) {
    pendingWrites.delete(session)
    session.promptSuggestionMemory?.forget()
  }
  if (session.promptSuggestion) {
    session.promptSuggestion = null
    session.events?.publish()
  }
}

/** The suggestion saved for the leaf this session resumed at, if no turn ran since. */
export function restoreClaudePromptSuggestion(
  session: ClaudeSession,
  memory: ClaudePromptSuggestionMemory | undefined
): void {
  session.promptSuggestionMemory = memory
  const restored = session.promptSuggestionMemory?.restore(session.turnEndLeafUuid) ?? null
  if (restored) {
    session.promptSuggestion = restored
    session.events?.publish()
  }
}

export function observeClaudePromptSuggestion(
  session: ClaudeSession | null,
  event: ClaudeStructuredSessionEvent
): void {
  if (!session) {
    return
  }
  if (event.type === 'ended') {
    clearClaudePromptSuggestion(session, false)
    return
  }
  if (event.type !== 'message') {
    return
  }
  const { message } = event
  if (event.startsTurn || message.type === 'assistant') {
    clearClaudePromptSuggestion(session)
  } else if (message.type === 'result') {
    clearClaudePromptSuggestion(session)
    session.promptSuggestionResultSequence =
      message.is_error !== true && session.dispatchWaiters.length === 0
        ? session.dispatchSequence
        : undefined
  } else if (
    message.type === 'prompt_suggestion' &&
    session.promptSuggestionResultSequence === session.dispatchSequence &&
    session.dispatchWaiters.length === 0 &&
    typeof message.suggestion === 'string' &&
    message.suggestion.trim() &&
    message.suggestion.length <= 4096 &&
    message.suggestion !== session.promptSuggestion
  ) {
    session.promptSuggestion = message.suggestion
    const completed = session.resumePointWrite
    if (completed) {
      const write = {}
      const suggestion = message.suggestion
      pendingWrites.set(session, write)
      // The journal must accept this turn's output before its suggestion can survive a restart.
      void completed.settled.then(() => {
        if (pendingWrites.get(session) !== write) {
          return
        }
        pendingWrites.delete(session)
        if (session.turnEndLeafUuid === completed.leafUuid) {
          session.promptSuggestionMemory?.save(suggestion, completed.leafUuid)
        }
      })
    }
    session.events?.publish()
  }
}
