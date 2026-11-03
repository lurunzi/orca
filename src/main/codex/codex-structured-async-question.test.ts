import { describe, expect, it } from 'vitest'
import { AgentJournalItemBodySchema } from '../../shared/agent-session/journal/agent-session-journal-schemas'
import {
  extractPendingAsk,
  scanPendingAsks,
  asyncQuestionOccurrenceId
} from '../../shared/native-chat/input/native-chat-ask'
import { agentJournalItemKey } from '../../shared/agent-session/journal/agent-session-journal-item-key'
import type { NativeChatMessage } from '../../shared/native-chat/native-chat-types'
import {
  codexItemBody,
  codexItemIdentity,
  CodexTurnOrdinals,
  type CodexThreadItem
} from './codex-structured-item-translation'

const ASYNC_ITEM: CodexThreadItem = {
  type: 'agentMessage',
  id: 'call-async-1',
  text: 'Was the backup disk moved?\n- Moved\n- Not moved',
  phase: 'final_answer',
  delivery: 'async',
  questions: [{ title: 'Was the backup disk moved?', options: ['Moved', 'Not moved'] }]
}

function asMessage(item: CodexThreadItem): NativeChatMessage {
  const body = codexItemBody(item)
  if (body?.kind !== 'message') {
    throw new Error('expected a message body')
  }
  return { id: item.id, role: body.role, blocks: body.blocks, timestamp: 1, source: 'transcript' }
}

describe('Codex async question items', () => {
  it('carries an async question on its message so clients can answer it', () => {
    const body = codexItemBody({
      type: 'agentMessage',
      id: 'call-async',
      text: 'Which color?\n- Red\n- Blue',
      phase: 'final_answer',
      delivery: 'async',
      questions: [
        { title: 'Which color?', options: ['Red', 'Blue'] },
        { title: 'Why?', options: null }
      ]
    })
    const blocks = body?.kind === 'message' ? body.blocks : []

    expect(blocks[0]).toEqual({ type: 'text', text: 'Which color?\n- Red\n- Blue' })
    expect(
      extractPendingAsk([
        { id: 'm', role: 'assistant', blocks, timestamp: null, source: 'transcript' }
      ])
    ).toEqual({
      replyAsMessage: true,
      questions: [
        {
          question: 'Which color?',
          multiSelect: false,
          options: [{ label: 'Red' }, { label: 'Blue' }]
        },
        { question: 'Why?', multiSelect: false, options: [] }
      ]
    })
  })

  it('keeps the prose ahead of a journal-valid question call', () => {
    const body = codexItemBody(ASYNC_ITEM)
    expect(body).toMatchObject({
      kind: 'message',
      role: 'assistant',
      blocks: [
        { type: 'text', text: 'Was the backup disk moved?\n- Moved\n- Not moved' },
        { type: 'tool-call', name: 'request_user_input_async', callId: 'call-async-1' }
      ]
    })
    expect(AgentJournalItemBodySchema.safeParse(body).success).toBe(true)
  })

  it('leaves ordinary and malformed agent messages as prose only', () => {
    const plain: CodexThreadItem = { type: 'agentMessage', id: 'plain', text: 'Q?\n- a\n- b' }
    const noQuestions: CodexThreadItem = { ...ASYNC_ITEM, id: 'bare', questions: null }
    const notAsync: CodexThreadItem = { ...ASYNC_ITEM, id: 'sync', delivery: null }
    for (const item of [plain, noQuestions, notAsync]) {
      expect(codexItemBody(item)).toEqual({
        kind: 'message',
        role: 'assistant',
        blocks: [{ type: 'text', text: item.text }]
      })
      expect(extractPendingAsk([asMessage(item)])).toBeNull()
    }
  })

  it('keeps a resumed async item dismissed when provider IDs renumber, but identifies later rows', () => {
    function project(rawId: string, ordinals: CodexTurnOrdinals): NativeChatMessage {
      const item = {
        type: 'agentMessage',
        id: rawId,
        text: 'Which color?',
        delivery: 'async',
        questions: [{ title: 'Which color?', options: ['Red', 'Blue'] }]
      }
      const body = codexItemBody(item)
      if (body?.kind !== 'message') {
        throw new Error('Expected an async message')
      }
      return {
        id: agentJournalItemKey(
          codexItemIdentity({ threadId: 'thread', turnId: 'turn', item, ordinals })
        ),
        role: 'assistant',
        blocks: body.blocks,
        timestamp: null,
        source: 'transcript'
      }
    }
    const liveOrdinals = new CodexTurnOrdinals()
    const live = project('live-call-async', liveOrdinals)
    const resumed = project('item-0', new CodexTurnOrdinals())
    const key = (row: NativeChatMessage) =>
      asyncQuestionOccurrenceId(
        'journal/host/thread/epoch',
        scanPendingAsks([row]).contributors[0]!
      )
    expect(live.id).toBe(resumed.id)
    expect(key(live)).not.toBeNull()
    expect(key(resumed)).toBe(key(live))
    expect(key(project('later-call-async', liveOrdinals))).not.toBe(key(live))
  })
})
