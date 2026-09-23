import type { NativeChatMessage } from '../../shared/native-chat-types'
import { asRecord, extractString, parseJsonObject } from '../ai-vault/session-scanner-values'
import { stripGrokUserQueryEnvelope } from '../ai-vault/session-scanner-grok-user-text'
import { claudeContentBlocks } from './transcript-record-blocks'

const CURSOR_QUERY_PREFIX =
  /^(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [^\r\n]+\r?\n)?<user_query>/i

/** Cursor Agent message rows carry Claude-shaped content blocks without ids or timestamps. */
export function decodeCursorTranscriptLine(
  line: string,
  fallbackId: string
): NativeChatMessage | null {
  const record = parseJsonObject(line)
  const role = extractString(record?.role)
  if (role !== 'user' && role !== 'assistant') {
    return null
  }
  const blocks = claudeContentBlocks(asRecord(record?.message)?.content).flatMap((block) => {
    if (
      role !== 'user' ||
      block.type !== 'text' ||
      !CURSOR_QUERY_PREFIX.test(block.text.trimStart())
    ) {
      return [block]
    }
    // Cursor uses the same query envelope; pending echoes must match the typed text.
    const text = stripGrokUserQueryEnvelope(block.text)
    return text ? [{ ...block, text }] : []
  })
  return blocks.length > 0
    ? { id: fallbackId, role, blocks, timestamp: null, source: 'transcript' }
    : null
}
