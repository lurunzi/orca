import type { AgentJournalItemIdentity } from '../../shared/agent-session-journal-types'
import {
  claudeRecord,
  claudeText,
  claudeThinkingIdentity
} from './claude-structured-item-translation'

export type ClaudeStreamedRole = 'assistant' | 'reasoning'

type StreamedBlock = { identity: AgentJournalItemIdentity; role: ClaudeStreamedRole }

// Under --include-partial-messages every stream_event frame carries its own
// uuid, and the block's final `assistant` frame carries yet another; only
// `message.id` ties them together. The block's first stream frame mints the
// journal identity, and the final frame lands on it in block order instead of
// appending a duplicate under its own uuid.

export type ClaudeStreamedTextDelta = {
  identity: AgentJournalItemIdentity
  text: string
  role: ClaudeStreamedRole
  /** The block's own scope, which this registry already keys its map on. Streamed
   *  prose has no message envelope when it is persisted, so the producer travels
   *  with the delta rather than being re-read from a frame that is long gone. */
  parentToolUseId: string | null
}

type StreamedMessage = {
  messageId: string | null
  blocks: Map<number, StreamedBlock>
  /** Streamed blocks whose final assistant frame has not arrived, in block order. */
  awaitingFinal: StreamedBlock[]
}

export type ClaudeStreamedBlockRegistry = {
  /** Text a stream_event frame appends to its block, or null when it carries none. */
  observe: (frame: Record<string, unknown>) => ClaudeStreamedTextDelta | null
  /** The streamed identity a final assistant frame reconciles onto, if its block streamed. */
  reconcile: (
    frame: {
      sessionId: string
      parentToolUseId: string | null
      messageId: string | null
    },
    role?: ClaudeStreamedRole
  ) => AgentJournalItemIdentity | null
  clear: () => void
}

function scopeKey(sessionId: string, parentToolUseId: string | null): string {
  return `${sessionId}/${parentToolUseId ?? ''}`
}

export function createClaudeStreamedBlockRegistry(): ClaudeStreamedBlockRegistry {
  const messages = new Map<string, StreamedMessage>()

  const messageFor = (scope: string): StreamedMessage => {
    let streamed = messages.get(scope)
    if (!streamed) {
      streamed = { messageId: null, blocks: new Map(), awaitingFinal: [] }
      messages.set(scope, streamed)
    }
    return streamed
  }

  const mint = (
    streamed: StreamedMessage,
    sessionId: string,
    index: number,
    uuid: string,
    role: ClaudeStreamedRole
  ): StreamedBlock => {
    const identity: AgentJournalItemIdentity =
      role === 'reasoning'
        ? claudeThinkingIdentity(sessionId, uuid)
        : { provider: 'claude', sessionId, uuid }
    const block = { identity, role }
    streamed.blocks.set(index, block)
    streamed.awaitingFinal.push(block)
    return block
  }

  return {
    observe: (frame) => {
      const event = claudeRecord(frame.event)
      const sessionId = claudeText(frame.session_id)
      const uuid = claudeText(frame.uuid)
      if (frame.type !== 'stream_event' || !event || !sessionId || !uuid) {
        return null
      }
      const parentToolUseId = claudeText(frame.parent_tool_use_id)
      const scope = scopeKey(sessionId, parentToolUseId)
      if (event.type === 'message_start') {
        messages.set(scope, {
          messageId: claudeText(claudeRecord(event.message)?.id),
          blocks: new Map(),
          awaitingFinal: []
        })
        return null
      }
      const index = typeof event.index === 'number' ? event.index : 0
      if (event.type === 'content_block_start') {
        const block = claudeRecord(event.content_block)
        if (block?.type !== 'text' && block?.type !== 'thinking') {
          return null
        }
        const role = block.type === 'thinking' ? 'reasoning' : 'assistant'
        const streamed = mint(messageFor(scope), sessionId, index, uuid, role)
        const text = claudeText(block.type === 'thinking' ? block.thinking : block.text)
        return text ? { ...streamed, text, parentToolUseId } : null
      }
      if (event.type !== 'content_block_delta') {
        return null
      }
      const delta = claudeRecord(event.delta)
      const role = delta?.type === 'thinking_delta' ? 'reasoning' : 'assistant'
      const text =
        delta?.type === 'text_delta'
          ? claudeText(delta.text)
          : delta?.type === 'thinking_delta'
            ? claudeText(delta.thinking)
            : null
      if (!text) {
        return null
      }
      const streamed = messageFor(scope)
      const block = streamed.blocks.get(index) ?? mint(streamed, sessionId, index, uuid, role)
      return block.role === role ? { ...block, text, parentToolUseId } : null
    },
    reconcile: (frame, role = 'assistant') => {
      const streamed = messages.get(scopeKey(frame.sessionId, frame.parentToolUseId))
      if (
        !streamed ||
        (frame.messageId && streamed.messageId && frame.messageId !== streamed.messageId)
      ) {
        return null
      }
      const index = streamed.awaitingFinal.findIndex((block) => block.role === role)
      return index === -1 ? null : (streamed.awaitingFinal.splice(index, 1)[0]?.identity ?? null)
    },
    clear: () => messages.clear()
  }
}
