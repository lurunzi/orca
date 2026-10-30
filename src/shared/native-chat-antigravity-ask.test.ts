import { describe, expect, it } from 'vitest'
import { parseAntigravityAskInput } from './native-chat-antigravity-ask'
import { buildAntigravityAskAnswerKeys } from './native-chat-antigravity-answer'
import { extractPendingAsk, parseAskFromStatus } from './native-chat/input/native-chat-ask'
import { decodeAntigravityTranscriptLine } from '../main/native-chat/transcript-line-decoders-antigravity'

// Captured agy tool arguments; terminal evidence: antigravity-question-answer.txt.
const input = {
  questions: JSON.stringify([
    { question: 'Color', options: ['Red', 'Blue'], is_multi_select: false },
    { question: 'Pets', options: ['Cat', 'Dog'], is_multi_select: true },
    { question: 'Size', options: ['Small', 'Large'], is_multi_select: false }
  ])
}

describe('Antigravity questions', () => {
  it('decodes the string array and preserves option order and multi-select', () => {
    const prompt = parseAskFromStatus(JSON.stringify(input), 'ask_question')
    expect(prompt?.questions).toEqual([
      { question: 'Color', options: [{ label: 'Red' }, { label: 'Blue' }], multiSelect: false },
      { question: 'Pets', options: [{ label: 'Cat' }, { label: 'Dog' }], multiSelect: true },
      { question: 'Size', options: [{ label: 'Small' }, { label: 'Large' }], multiSelect: false }
    ])
    expect(parseAntigravityAskInput({ questions: JSON.parse(input.questions) })).toEqual(prompt)
    expect(parseAskFromStatus(JSON.stringify(prompt), 'ask_question')).toEqual(prompt)
  })

  it.each([
    null,
    {},
    { questions: '{bad' },
    { questions: 'null' },
    { questions: '[]' },
    { questions: [{ question: 'Pick', options: ['A', 3] }] },
    { questions: [{ question: 'Pick', options: ['A', 'B'] }, {}] }
  ])('rejects malformed input without shifting question or option positions: %j', (value) => {
    expect(parseAntigravityAskInput(value)).toBeNull()
    expect(parseAskFromStatus(JSON.stringify(value), 'ask_question')).toBeNull()
  })

  it('recovers a pending transcript question and clears it on its actual result', () => {
    const call = decodeAntigravityTranscriptLine(
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        tool_calls: [{ name: 'ask_question', args: input }]
      }),
      'call'
    )!
    const result = decodeAntigravityTranscriptLine(
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'GENERIC',
        status: 'DONE',
        content: 'A1: Blue\nA2: Cat, Other pet\nA3: User Skipped'
      }),
      'result'
    )!
    expect(extractPendingAsk([call])).toEqual(parseAntigravityAskInput(input))
    expect(extractPendingAsk([call, result])).toBeNull()
  })

  it('replays captured single-select, multi-select/write-in and skip keystrokes', () => {
    expect(
      buildAntigravityAskAnswerKeys(parseAntigravityAskInput(input)!, [
        { indices: [1] },
        { indices: [0], other: 'Other pet' },
        { indices: [] }
      ])
    ).toEqual([
      { raw: '\x1b[B' },
      { raw: '\r' },
      { raw: ' ' },
      { raw: '\x1b[B' },
      { raw: '\x1b[B' },
      { raw: '\r' },
      { text: 'Other pet' },
      { raw: '\r' },
      { raw: '\x1b' }
    ])
  })

  it('toggles each selected checkbox once in display order', () => {
    const prompt = parseAntigravityAskInput(input)!
    expect(
      buildAntigravityAskAnswerKeys({ questions: [prompt.questions[1]!] }, [{ indices: [1, 0, 1] }])
    ).toEqual([{ raw: ' ' }, { raw: '\x1b[B' }, { raw: ' ' }, { raw: '\r' }])
  })
})
