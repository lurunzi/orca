import type {
  StructuredAgentSessionAction,
  StructuredAgentSessionState
} from '../../../../../src/shared/agent-session/structured-agent-session-reducer'
import { withPromptSuggestion } from '../../../../../src/shared/structured-agent-session-prompt-suggestion-reducer'
import { reduceStructuredChatState } from '../transcript/mobile-native-chat-transcript-writer'

/** The stored-copy session reducer plus the host's prompt suggestion, which the shared reducer does not carry. */
export function reduceMobileStructuredAgentState(
  previous: StructuredAgentSessionState,
  action: StructuredAgentSessionAction,
  receivedAt: number
): StructuredAgentSessionState {
  return withPromptSuggestion(
    previous,
    reduceStructuredChatState(previous, action, receivedAt),
    action
  )
}
