import { describe, expect, it } from 'vitest'
import { normalizeHookPayload } from './normalize-hook-payload'
import { createHookListenerState } from '../listener-state'
import { parseAskFromStatus } from '../../native-chat/input/native-chat-ask'
import { makePaneKey } from '../../workspace-layout/stable-pane-id'

const PANE_KEY = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')

describe('Antigravity question hook lifecycle', () => {
  it('publishes the full prompt, then clears it after the answer', () => {
    const state = createHookListenerState()
    const toolCall = {
      name: 'ask_question',
      args: {
        questions: JSON.stringify([
          { question: 'Pick a pet', options: ['Cat', 'Dog'], is_multi_select: true }
        ])
      }
    }
    const event = (hook_event_name: string) =>
      normalizeHookPayload(
        state,
        'antigravity',
        {
          paneKey: PANE_KEY,
          hook_event_name,
          payload: { toolCall }
        },
        'production'
      )?.payload
    const waiting = event('PreToolUse')
    expect(waiting?.state).toBe('waiting')
    expect(parseAskFromStatus(waiting?.interactivePrompt, waiting?.toolName)?.questions).toEqual([
      { question: 'Pick a pet', options: [{ label: 'Cat' }, { label: 'Dog' }], multiSelect: true }
    ])
    const answered = event('PostToolUse')
    expect(answered?.state).toBe('working')
    expect(answered?.interactivePrompt).toBeUndefined()
    expect(event('Stop')?.interactivePrompt).toBeUndefined()
  })

  it('does not synthesize a question for malformed input or an ordinary turn end', () => {
    const state = createHookListenerState()
    const result = normalizeHookPayload(
      state,
      'antigravity',
      {
        paneKey: PANE_KEY,
        hook_event_name: 'PreToolUse',
        payload: { toolCall: { name: 'ask_question', args: { questions: '{bad' } } }
      },
      'production'
    )
    expect(result?.payload.interactivePrompt).toBeUndefined()
    const stopped = normalizeHookPayload(
      state,
      'antigravity',
      {
        paneKey: PANE_KEY,
        hook_event_name: 'Stop',
        payload: { fullyIdle: true }
      },
      'production'
    )
    expect(stopped?.payload.state).toBe('done')
    expect(stopped?.payload.interactivePrompt).toBeUndefined()
  })
})
