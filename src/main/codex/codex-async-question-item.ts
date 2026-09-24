import { CODEX_ASYNC_ASK_TOOL_NAME, parseAsyncAskInput } from '../../shared/native-chat-async-ask'
import type { NativeChatBlock } from '../../shared/native-chat-types'
import {
  boundToolInput,
  DEFAULT_JOURNAL_PAYLOAD_LIMITS
} from '../native-chat/agent-session-journal/journal-payload-bounds'
import type { CodexThreadItem } from './codex-thread-item-identity'

/**
 * Blocks that let clients render an app-server async question (`agentMessage`
 * with `delivery: "async"` and `questions`) as an answerable card. Appended after
 * the prose so older clients still read the question as text. The result block
 * mirrors the rollout's `{"accepted":true}` acknowledgement, not an answer.
 */
export function codexAsyncQuestionBlocks(item: CodexThreadItem): NativeChatBlock[] {
  if (item.type !== 'agentMessage' || item.delivery !== 'async') {
    return []
  }
  const input = { questions: item.questions }
  if (!parseAsyncAskInput(input)) {
    return []
  }
  return [
    {
      type: 'tool-call',
      name: CODEX_ASYNC_ASK_TOOL_NAME,
      callId: item.id,
      input: boundToolInput(input, DEFAULT_JOURNAL_PAYLOAD_LIMITS),
      state: 'completed'
    },
    { type: 'tool-result', output: '{"accepted":true}' }
  ]
}
