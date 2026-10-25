import { describe, expect, it } from 'vitest'
import { AgentJournalItemBodySchema } from '../../shared/agent-session-journal-schemas'
import { extractPendingAsk } from '../../shared/native-chat-ask'
import type { NativeChatMessage } from '../../shared/native-chat-types'
import { codexItemBody, type CodexThreadItem } from './codex-structured-item-translation'

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
})
