import {
  reduceStructuredAgentSession,
  type StructuredAgentSessionAction,
  type StructuredAgentSessionState
} from './structured-agent-session-reducer'

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

/** Fork: the upstream reducer plus Claude's prompt suggestion, which a frame omits when unchanged. */
export function reduceWithPromptSuggestion(
  state: StructuredAgentSessionState,
  action: StructuredAgentSessionAction,
  receivedAt?: number
): StructuredAgentSessionState {
  const next = reduceStructuredAgentSession(state, action, receivedAt)
  const promptSuggestion = nextPromptSuggestion(state, action)
  return next.promptSuggestion === promptSuggestion ? next : { ...next, promptSuggestion }
}
