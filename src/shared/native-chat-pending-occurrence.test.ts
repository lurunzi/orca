import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from './native-chat-types'
import {
  assignNativeChatPendingOccurrence,
  countLeadingPendingTextsGluedToUserText,
  countPendingTextsGluedAfterTruncatedLead
} from './native-chat-pending-occurrence'
import {
  pendingSendsAsMessages,
  prunePendingSends,
  type NativeChatPendingSend
} from './native-chat-pending-sends'

function message(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  timestamp: number
): NativeChatMessage {
  return {
    id,
    role,
    blocks: [{ type: 'text', text }],
    timestamp,
    source: 'transcript'
  }
}

describe('pending send occurrence reconciliation', () => {
  it('keeps the next identical echo after pruning an earlier occurrence', () => {
    const first = assignNativeChatPendingOccurrence<NativeChatPendingSend>([], {
      id: 'p1',
      text: 'repeat',
      sentAt: 100,
      afterMessageId: 'paged-out-boundary'
    })
    const repeated = [
      first,
      assignNativeChatPendingOccurrence([first], {
        id: 'p2',
        text: 'repeat',
        sentAt: 200,
        afterMessageId: 'paged-out-boundary'
      })
    ]
    expect(first.matchingOccurrence).toBeUndefined()
    expect(repeated[1]).toMatchObject({ matchingOccurrence: 2, matchingAfterTimestamp: 100 })

    const firstCompletedTurn = [
      message('u1', 'user', 'repeat', 150),
      message('a1', 'assistant', 'done', 160)
    ]
    const afterFirstPrune = prunePendingSends(repeated, firstCompletedTurn)

    expect(afterFirstPrune.map((entry) => entry.id)).toEqual(['p2'])
    expect(
      pendingSendsAsMessages(afterFirstPrune, firstCompletedTurn).map((entry) => entry.id)
    ).toEqual(['pending:p2'])

    const secondCompletedTurn = [
      ...firstCompletedTurn,
      message('u2', 'user', 'repeat', 250),
      message('a2', 'assistant', 'done again', 260)
    ]
    expect(pendingSendsAsMessages(afterFirstPrune, secondCompletedTurn)).toEqual([])
    expect(prunePendingSends(afterFirstPrune, secondCompletedTurn)).toEqual([])
  })
})

describe('countLeadingPendingTextsGluedToUserText line continuation', () => {
  it('glues a send whose trailing backslash the TUI ate as a line continuation', () => {
    expect(countLeadingPendingTextsGluedToUserText(['a\\', 'b'], 'a b')).toBe(2)
    expect(countLeadingPendingTextsGluedToUserText(['a\\', 'b'], 'ab')).toBe(2)
    expect(countLeadingPendingTextsGluedToUserText(['a\\', 'b'], 'a\\ b')).toBe(2)
    expect(countLeadingPendingTextsGluedToUserText(['x', 'C:\\dir\\', 'y'], 'x C:\\dir y')).toBe(3)
  })

  it('never drops the backslash of the send that ends the row', () => {
    expect(countLeadingPendingTextsGluedToUserText(['a', 'b\\'], 'a b')).toBe(0)
    expect(countLeadingPendingTextsGluedToUserText(['\\', 'b'], ' b')).toBe(0)
  })
})

describe('countPendingTextsGluedAfterTruncatedLead', () => {
  it('counts a truncated lead followed by whole later sends', () => {
    expect(
      countPendingTextsGluedAfterTruncatedLead(['ask me if the rest', 'go?'], 'ask me if go?')
    ).toBe(2)
    expect(
      countPendingTextsGluedAfterTruncatedLead(['ask me if the rest', 'go?'], 'ask me ifgo?')
    ).toBe(2)
    expect(countPendingTextsGluedAfterTruncatedLead(['abc def', 'x', 'y'], 'abc x y')).toBe(3)
  })

  it('rejects rows whose lead is empty, whole, or not from the first send', () => {
    expect(countPendingTextsGluedAfterTruncatedLead(['ask me', 'go?'], 'go?')).toBe(0)
    expect(countPendingTextsGluedAfterTruncatedLead(['ask me', 'go?'], 'ask me go?')).toBe(0)
    expect(countPendingTextsGluedAfterTruncatedLead(['ask me', 'go?'], 'tell me go?')).toBe(0)
    expect(countPendingTextsGluedAfterTruncatedLead(['ask me', 'go?'], 'ask go? now')).toBe(0)
    expect(countPendingTextsGluedAfterTruncatedLead(['ask me'], 'ask')).toBe(0)
  })
})

describe('pending sends typed through an agent TUI', () => {
  const COMPOSER_TEXT = 'summarize the failing test and propose a fix'

  it('prunes the echo of a row carrying the clear byte', () => {
    const pending = [{ id: 'p1', text: COMPOSER_TEXT, sentAt: 100, afterMessageId: 'boundary' }]
    const transcript = [
      message('u1', 'user', `\u0015${COMPOSER_TEXT}`, 150),
      message('a1', 'assistant', 'done', 160)
    ]

    expect(prunePendingSends(pending, transcript)).toEqual([])
    expect(pendingSendsAsMessages(pending, transcript)).toEqual([])
  })
})
