import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../native-chat-types'
import {
  pendingSendsAsMessages,
  prunePendingSends,
  type NativeChatPendingSend
} from './native-chat-pending-sends'

function userMessage(id: string, text: string, timestamp = 1): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp,
    source: 'transcript'
  }
}

function assistantMessage(id: string, text: string, timestamp = 2): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', text }],
    timestamp,
    source: 'transcript'
  }
}

const pendingOf = (id: string, text: string): NativeChatPendingSend => ({ id, text, sentAt: 100 })

describe('pending sends against whole-second transcript stamps', () => {
  it('retires a first send whose transcript stamp is truncated to the second (antigravity)', () => {
    const second = Date.parse('2026-09-24T17:06:44Z')
    const pending = [
      { ...pendingOf('first-send', 'record state'), sentAt: second + 300, afterMessageId: null }
    ]
    const transcript = [
      { ...userMessage('user', 'record state'), timestamp: second },
      { ...assistantMessage('answer', 'checking'), timestamp: second }
    ]

    expect(pendingSendsAsMessages(pending, transcript)).toEqual([])
    expect(prunePendingSends(pending, transcript)).toEqual([])
  })

  it('still ignores a whole-second turn from before the send second', () => {
    const second = Date.parse('2026-09-24T17:06:44Z')
    const pending = [
      { ...pendingOf('new-send', 'run tests'), sentAt: second + 300, afterMessageId: null }
    ]
    const history = [
      { ...userMessage('old-user', 'run tests'), timestamp: second - 1000 },
      { ...assistantMessage('old-answer', 'passed'), timestamp: second - 1000 }
    ]

    expect(prunePendingSends(pending, history)).toEqual(pending)
  })
})
