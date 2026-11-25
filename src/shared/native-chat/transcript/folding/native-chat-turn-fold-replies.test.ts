import { describe, expect, it } from 'vitest'
import {
  nativeChatTurnAnswerRows,
  nativeChatTurnFold,
  type NativeChatTurnFoldRow
} from './native-chat-turn-fold'

function row(overrides: Partial<NativeChatTurnFoldRow> = {}): NativeChatTurnFoldRow {
  return {
    turnKey: 'turn-1',
    role: 'assistant',
    rendersProse: true,
    draws: true,
    outlivesTurn: false,
    reportsFailure: false,
    explainsTurn: false,
    endsAnswer: false,
    asks: false,
    replyEnd: undefined,
    failedHook: false,
    ...overrides
  }
}

describe('nativeChatTurnFold replies', () => {
  it('keeps the answer before a hidden delivery when the agent replies to it', () => {
    // Prompt → answer, then a cross-session message (dropped from the transcript)
    // the agent replies to inside the same turn.
    const rows = [
      row({ role: 'user' }),
      row({ rendersProse: false }),
      row(),
      row({ role: 'reasoning', rendersProse: false, startsReply: true }),
      row({ rendersProse: false }),
      row()
    ]
    expect([...nativeChatTurnAnswerRows(rows)]).toEqual([2, 5])
    const { foldedRows } = nativeChatTurnFold({
      rows,
      settledTurnKeys: new Set(['turn-1']),
      expandedTurnKeys: new Set<string>()
    })
    expect([...foldedRows].sort()).toEqual([1, 3, 4])
  })
})
