import { describe, expect, it } from 'vitest'
import { AgentJournalItemBodySchema } from '../../shared/agent-session-journal-schemas'
import { extractPendingAsyncAsk } from '../../shared/native-chat-async-ask'
import type { NativeChatMessage } from '../../shared/native-chat-types'
import { codexItemBody, type CodexThreadItem } from './codex-structured-item-translation'

// App-server `agentMessage` shape for an async question (codex app-server schema:
// `delivery: "async"`, `questions: AsyncUserInputQuestion[]`).
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

describe('codex structured async questions', () => {
  it('keeps the prose and adds an answerable async question call', () => {
    const body = codexItemBody(ASYNC_ITEM)
    expect(body).toMatchObject({
      kind: 'message',
      role: 'assistant',
      blocks: [
        { type: 'text', text: 'Was the backup disk moved?\n- Moved\n- Not moved' },
        { type: 'tool-call', name: 'request_user_input_async', callId: 'call-async-1' },
        { type: 'tool-result', output: '{"accepted":true}' }
      ]
    })
    expect(AgentJournalItemBodySchema.safeParse(body).success).toBe(true)
    expect(extractPendingAsyncAsk([asMessage(ASYNC_ITEM)])).toEqual({
      questions: [
        {
          question: 'Was the backup disk moved?',
          multiSelect: false,
          options: [{ label: 'Moved' }, { label: 'Not moved' }]
        }
      ]
    })
  })

  it('supports a title-only question', () => {
    const item = { ...ASYNC_ITEM, questions: [{ title: 'Any constraints?', options: null }] }
    expect(extractPendingAsyncAsk([asMessage(item)])?.questions[0]).toEqual({
      question: 'Any constraints?',
      multiSelect: false,
      options: []
    })
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
      expect(extractPendingAsyncAsk([asMessage(item)])).toBeNull()
    }
  })
})
