import { canMirrorLaunchDraftToNativeChat } from './native-chat/input/native-chat-launch-draft-mirrorability'
import { isNativeChatTranscriptLocalReadable } from './native-chat/transcript/native-chat-transcript-readability'
import {
  nativeChatPreferenceFor,
  type NativeChatDefaultSettings
} from './structured-native-chat-launch-route'

export const TRANSCRIPT_CHAT_AGENTS = ['cursor', 'antigravity'] as const

export function isTranscriptChatAgent(
  agent: string
): agent is (typeof TRANSCRIPT_CHAT_AGENTS)[number] {
  return TRANSCRIPT_CHAT_AGENTS.some((candidate) => candidate === agent)
}

/** Fork: an agent whose terminal launch opens Orca's transcript chat view, so the new-tab
 *  menu lists it with the chats, not as a CLI. */
export function opensTranscriptChatFromTerminal(
  settings: NativeChatDefaultSettings | null | undefined,
  agent: string
): boolean {
  return isTranscriptChatAgent(agent) && nativeChatPreferenceFor(settings, agent)
}

/** Terminal-backed chats respect an explicit terminal choice. */
export function initialTranscriptChatView(input: {
  agent: string
  settings: NativeChatDefaultSettings | null | undefined
  connectionId: string | null | undefined
  requestedSurface?: 'chat' | 'terminal'
  draft?: string
}): 'chat' | undefined {
  if (
    !isTranscriptChatAgent(input.agent) ||
    input.requestedSurface === 'terminal' ||
    !nativeChatPreferenceFor(input.settings, input.agent) ||
    !isNativeChatTranscriptLocalReadable(input.connectionId) ||
    (input.draft !== undefined && !canMirrorLaunchDraftToNativeChat(input.draft))
  ) {
    return undefined
  }
  return 'chat'
}
