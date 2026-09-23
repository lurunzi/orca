import { describe, expect, it } from 'vitest'
import { decodeCursorTranscriptLine } from '../../src/main/native-chat/transcript-line-decoders-cursor'
import {
  pendingSendsAsMessages,
  prunePendingSends,
  launchPromptAsMessage
} from '../../src/renderer/src/components/native-chat/native-chat-pending'

function cursorMessage(role: 'user' | 'assistant', text: string, id: string) {
  const message = decodeCursorTranscriptLine(
    JSON.stringify({ role, message: { content: [{ type: 'text', text }] } }),
    id
  )
  if (!message) {
    throw new Error('Expected a Cursor transcript message')
  }
  return message
}

const query = 'Wednesday, Sep 23, 2026, 1:44 AM (UTC+1)\n<user_query>\n1为eeqe\n</user_query>'
const pending = [{ id: 'send', text: '1为eeqe', sentAt: 100 }]

describe('Cursor query envelope reconciliation', () => {
  it('hides the echo when the user record arrives and retires it after the reply', () => {
    const user = cursorMessage('user', query, 'cursor:0')
    expect(pendingSendsAsMessages(pending, [user])).toEqual([])
    expect(prunePendingSends(pending, [user])).toEqual(pending)
    expect(
      prunePendingSends(pending, [user, cursorMessage('assistant', 'Checking', 'cursor:1')])
    ).toEqual([])
  })

  it('keeps a later identical send until its own record arrives', () => {
    const user = cursorMessage('user', query, 'cursor:0')
    const reply = cursorMessage('assistant', 'Checking', 'cursor:1')
    const next = [{ ...pending[0], afterMessageId: reply.id }]
    expect(pendingSendsAsMessages(next, [user, reply])).toHaveLength(1)
    expect(
      pendingSendsAsMessages(next, [user, reply, cursorMessage('user', query, 'cursor:2')])
    ).toEqual([])
  })

  it('reconciles a first prompt supplied when launching Cursor', () => {
    expect(
      launchPromptAsMessage({ tabId: 'tab', agent: 'cursor', text: '1为eeqe', createdAt: 100 }, [
        cursorMessage('user', query, 'cursor:0')
      ])
    ).toBeNull()
  })
})
