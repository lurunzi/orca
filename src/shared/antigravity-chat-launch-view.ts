import { canMirrorLaunchDraftToNativeChat } from './native-chat-launch-draft-mirrorability'
import { isNativeChatTranscriptLocalReadable } from './native-chat-transcript-readability'
import {
  isNativeChatEnabled,
  type NativeChatDefaultSettings
} from './structured-native-chat-launch-route'

/** Antigravity runs in a terminal but opens its existing transcript view when Chat UI is on. */
export function initialAntigravityChatView(input: {
  agent: string
  settings: Partial<NativeChatDefaultSettings> | null | undefined
  connectionId: string | null | undefined
  draft?: string
}): 'chat' | undefined {
  if (
    input.agent !== 'antigravity' ||
    !isNativeChatEnabled(input.settings) ||
    !isNativeChatTranscriptLocalReadable(input.connectionId) ||
    (input.draft !== undefined && !canMirrorLaunchDraftToNativeChat(input.draft))
  ) {
    return undefined
  }
  return 'chat'
}
