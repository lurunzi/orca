import type { TuiAgent } from '../../../shared/tui-agent'
import {
  isNativeChatDefaultFor,
  type NativeChatDefaultSettings
} from '../../../shared/structured-native-chat-launch-route'

/** Fork: an agent whose terminal launch opens Orca's transcript chat view (see
 *  antigravity-chat-launch-view), so the new-tab menu lists it with the chats, not as a CLI. */
export function opensTranscriptChatFromTerminal(
  settings: Partial<NativeChatDefaultSettings> | null | undefined,
  agent: TuiAgent
): boolean {
  return agent === 'antigravity' && isNativeChatDefaultFor(settings, agent)
}
