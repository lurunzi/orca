import {
  reduceStructuredAgentSession,
  type StructuredAgentSessionAction,
  type StructuredAgentSessionState
} from './agent-session/structured-agent-session-reducer'

function nextPromptSuggestion(
  state: StructuredAgentSessionState,
  action: StructuredAgentSessionAction
): string | null | undefined {
  if (action.type !== 'event') {
    return state.promptSuggestion
  }
  const { event } = action
  if (event.type === 'snapshot' || event.type === 'reset') {
    return event.promptSuggestion
  }
  return event.type === 'batch' && event.promptSuggestion !== undefined
    ? event.promptSuggestion
    : state.promptSuggestion
}

/** Fork: carries Claude's prompt suggestion, which a frame omits when unchanged, onto a reduced state. */
export function withPromptSuggestion(
  previous: StructuredAgentSessionState,
  next: StructuredAgentSessionState,
  action: StructuredAgentSessionAction
): StructuredAgentSessionState {
  const promptSuggestion = nextPromptSuggestion(previous, action)
  return next.promptSuggestion === promptSuggestion ? next : { ...next, promptSuggestion }
}

/** Fork: the upstream reducer plus Claude's prompt suggestion. */
export function reduceWithPromptSuggestion(
  state: StructuredAgentSessionState,
  action: StructuredAgentSessionAction,
  receivedAt?: number
): StructuredAgentSessionState {
  return withPromptSuggestion(
    state,
    reduceStructuredAgentSession(state, action, receivedAt),
    action
  )
}
