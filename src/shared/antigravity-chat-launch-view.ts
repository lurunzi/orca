import { canMirrorLaunchDraftToNativeChat } from './native-chat-launch-draft-mirrorability'
import { isNativeChatTranscriptLocalReadable } from './native-chat-transcript-readability'
import {
  isNativeChatDefaultFor,
  type NativeChatDefaultSettings
} from './structured-native-chat-launch-route'

/** Antigravity runs in a terminal but opens its transcript view when its chat switch is on. */
export function initialAntigravityChatView(input: {
  agent: string
  settings: Partial<NativeChatDefaultSettings> | null | undefined
  connectionId: string | null | undefined
  draft?: string
}): 'chat' | undefined {
  if (
    input.agent !== 'antigravity' ||
    !isNativeChatDefaultFor(input.settings, 'antigravity') ||
    !isNativeChatTranscriptLocalReadable(input.connectionId) ||
    (input.draft !== undefined && !canMirrorLaunchDraftToNativeChat(input.draft))
  ) {
    return undefined
  }
  return 'chat'
}
