import { describe, expect, it } from 'vitest'
import { decodeCursorTurnLifecycle } from './transcript-turn-lifecycle'

describe('native chat transcript turn lifecycle', () => {
  it('decodes Cursor turn_ended without inventing ids, timestamps or failure messages', () => {
    expect(
      decodeCursorTurnLifecycle(
        JSON.stringify({ type: 'turn_ended', status: 'success' }),
        'cursor:success'
      )
    ).toEqual({ state: 'completed', turnId: 'cursor:success', timestamp: null })
    expect(
      decodeCursorTurnLifecycle(
        JSON.stringify({ type: 'turn_ended', status: 'error', error: 'request failed' }),
        'cursor:error'
      )
    ).toEqual({ state: 'completed', turnId: 'cursor:error', timestamp: null })
    expect(
      decodeCursorTurnLifecycle(
        JSON.stringify({ type: 'turn_ended', status: 'aborted', error: 'cancelled' }),
        'cursor:aborted'
      )
    ).toEqual({ state: 'interrupted', turnId: 'cursor:aborted', timestamp: null })
    expect(
      decodeCursorTurnLifecycle(
        JSON.stringify({ type: 'turn_ended', status: 'unknown' }),
        'cursor:unknown'
      )
    ).toBeNull()
  })
})
