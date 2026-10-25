import { describe, expect, it } from 'vitest'
import { formatAskAnswer } from './native-chat-ask-answer'
import { CODEX_ASYNC_QUESTION_TOOL } from './codex-async-question-input'
import { extractPendingAsk, parseAskFromToolInput } from './native-chat-ask'
import { nativeChatAskRunSubject } from './native-chat-ask-row'
import {
  NATIVE_CHAT_INTERRUPTED_STATUS_TEXT,
  type NativeChatBlock,
  type NativeChatMessage
} from './native-chat-types'

const parseAsyncAskInput = (input: unknown) =>
  parseAskFromToolInput(CODEX_ASYNC_QUESTION_TOOL, input)

// Shape captured from a Codex rollout: arguments stay a JSON string, options are plain strings.
const ASYNC_ARGS = JSON.stringify({
  questions: [{ title: 'Was the backup disk moved?', options: ['Moved', 'Not moved', 'Unsure'] }]
})
const TITLE_ONLY_ARGS = JSON.stringify({ questions: [{ title: 'Any constraints?' }] })

function message(
  id: string,
  role: NativeChatMessage['role'],
  blocks: NativeChatBlock[]
): NativeChatMessage {
  return { id, role, blocks, timestamp: null, source: 'transcript' }
}

const asyncCall = (input: unknown = ASYNC_ARGS): NativeChatMessage =>
  message('call', 'assistant', [{ type: 'tool-call', name: 'request_user_input_async', input }])
const ack = message('ack', 'tool', [{ type: 'tool-result', output: '{"accepted":true}' }])

describe('parseAsyncAskInput', () => {
  it('reads titles and string suggestions from JSON-encoded arguments', () => {
    expect(parseAsyncAskInput(ASYNC_ARGS)).toEqual({
      replyAsMessage: true,
      questions: [
        {
          question: 'Was the backup disk moved?',
          multiSelect: false,
          options: [{ label: 'Moved' }, { label: 'Not moved' }, { label: 'Unsure' }]
        }
      ]
    })
  })

  it('keeps a title-only question as a free-text question', () => {
    expect(parseAsyncAskInput(TITLE_ONLY_ARGS)?.questions).toEqual([
      { question: 'Any constraints?', multiSelect: false, options: [] }
    ])
  })

  it('rejects payloads without a usable title', () => {
    expect(parseAsyncAskInput('{"questions":[{"options":["a"]}]}')).toBeNull()
    expect(parseAsyncAskInput('not json')).toBeNull()
    expect(parseAsyncAskInput({ questions: [{ title: ' ', options: ['a'] }] })).toBeNull()
  })

  it('is what the shared tool-input parser and ask row use for the async tool', () => {
    expect(
      parseAskFromToolInput('request_user_input_async', TITLE_ONLY_ARGS)?.questions[0]
    ).toEqual({ question: 'Any constraints?', multiSelect: false, options: [] })
    const call: NativeChatBlock = {
      type: 'tool-call',
      name: 'request_user_input_async',
      input: ASYNC_ARGS
    }
    expect(nativeChatAskRunSubject([call])).toEqual({
      kind: 'question',
      text: 'Was the backup disk moved?'
    })
  })
})

describe('extractPendingAsk', () => {
  it('stays pending after the {"accepted":true} acknowledgement', () => {
    expect(extractPendingAsk([asyncCall(), ack])?.questions[0]?.question).toBe(
      'Was the backup disk moved?'
    )
  })

  it('stays pending past later agent work in the same or a finished turn', () => {
    const work = message('work', 'assistant', [
      { type: 'tool-call', name: 'exec', input: '{}' },
      { type: 'text', text: 'Checking the other host meanwhile.' }
    ])
    const workResult = message('work-result', 'tool', [{ type: 'tool-result', output: 'ok' }])
    expect(extractPendingAsk([asyncCall(), ack, work, workResult])).not.toBeNull()
  })

  it('is superseded by the next user turn or an interrupt', () => {
    const user = message('user', 'user', [{ type: 'text', text: 'Moved' }])
    const interrupt = message('stop', 'system', [
      { type: 'text', text: NATIVE_CHAT_INTERRUPTED_STATUS_TEXT }
    ])
    expect(extractPendingAsk([asyncCall(), ack, user])).toBeNull()
    expect(extractPendingAsk([asyncCall(), ack, interrupt])).toBeNull()
  })

  it('never turns plain assistant prose into a question', () => {
    const prose = message('prose', 'assistant', [
      { type: 'text', text: 'Was the backup disk moved?\n- Moved\n- Not moved' }
    ])
    expect(extractPendingAsk([prose])).toBeNull()
  })

  it('keeps blocking request_user_input on keystroke delivery', () => {
    const syncCall = message('sync', 'assistant', [
      {
        type: 'tool-call',
        name: 'request_user_input',
        input: { questions: [{ question: 'Which?', options: [{ label: 'A' }] }] }
      }
    ])
    expect(extractPendingAsk([syncCall])).toMatchObject({ questions: [{ question: 'Which?' }] })
    expect(extractPendingAsk([syncCall])?.replyAsMessage).toBeUndefined()
  })

  it('uses the shared resolver with message delivery instead of TUI keystrokes', () => {
    expect(extractPendingAsk([asyncCall()])).toMatchObject({ replyAsMessage: true })
    expect(extractPendingAsk([asyncCall(), ack])).toMatchObject({ replyAsMessage: true })
  })
})

describe('formatAskAnswer', () => {
  const prompt = parseAsyncAskInput(ASYNC_ARGS)!

  it('sends the chosen suggestion or typed text for a single question', () => {
    expect(formatAskAnswer(prompt, [{ indices: [1] }])).toBe(
      '> Was the backup disk moved?\n\nNot moved'
    )
    expect(formatAskAnswer(prompt, [{ indices: [], other: '  it is on the other host ' }])).toBe(
      '> Was the backup disk moved?\n\nit is on the other host'
    )
  })

  it('pairs each answered question with its title when several were asked', () => {
    const multi = parseAsyncAskInput({
      questions: [{ title: 'Disk?', options: ['Moved'] }, { title: 'Window?' }, { title: 'Skip?' }]
    })!
    expect(formatAskAnswer(multi, [{ indices: [0] }, { indices: [], other: 'tonight' }])).toBe(
      '> Disk?\n\nMoved\n\n> Window?\n\ntonight'
    )
  })
})
