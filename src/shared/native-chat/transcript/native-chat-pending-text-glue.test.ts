import { describe, expect, it } from 'vitest'
import {
  countLeadingPendingTextsGluedToUserText,
  countPendingTextsGluedAfterTruncatedLead
} from './native-chat-pending-text-glue'

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
