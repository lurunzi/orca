import { describe, expect, it } from 'vitest'
import { decodeClaudeTurnLifecycle, decodeCursorTurnLifecycle } from './transcript-turn-lifecycle'

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

  it('excludes Claude tool-result rows that also carry text sidecars', () => {
    expect(
      decodeClaudeTurnLifecycle(
        JSON.stringify({
          type: 'user',
          uuid: 'mixed-tool-result',
          timestamp: '2026-07-16T23:45:38.000Z',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' },
              { type: 'text', text: '<system-reminder>continue</system-reminder>' }
            ]
          }
        }),
        'fallback'
      )
    ).toBeNull()
  })
})
