import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractPendingAsk } from '../../shared/native-chat-ask'
import { extractPendingAsyncAsk } from '../../shared/native-chat-async-ask'
import { readNativeChatTranscript } from './transcript-reader'

let tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

// Scrubbed from a real Codex 0.15x paginated rollout: the call, the async
// AgentMessage echo, the `{"accepted":true}` ack, then the turn finishing
// before the user replies with an ordinary message.
const QUESTION = 'Was the backup disk moved to the other host?'
const ROLLOUT = [
  { type: 'session_meta', payload: { id: 'session-1', history_mode: 'paginated' } },
  item('2026-09-06T16:58:00.000Z', {
    type: 'UserMessage',
    id: 'user-1',
    content: [{ type: 'text', text: 'Why is the backup mount blocked?' }]
  }),
  {
    timestamp: '2026-09-06T16:58:43.211Z',
    type: 'response_item',
    payload: {
      type: 'function_call',
      id: 'fc_1',
      name: 'request_user_input_async',
      arguments: JSON.stringify({
        questions: [{ title: QUESTION, options: ['Moved', 'Not moved', 'Unsure'] }]
      }),
      call_id: 'call_1'
    }
  },
  item('2026-09-06T16:58:43.220Z', {
    type: 'AgentMessage',
    id: 'call_1',
    content: [{ type: 'Text', text: `${QUESTION}\n- Moved\n- Not moved\n- Unsure` }],
    phase: 'final_answer',
    delivery: 'async',
    questions: [{ title: QUESTION, options: ['Moved', 'Not moved', 'Unsure'] }]
  }),
  {
    timestamp: '2026-09-06T16:58:43.278Z',
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: 'call_1', output: '{"accepted":true}' }
  },
  item('2026-09-06T17:01:39.000Z', {
    type: 'AgentMessage',
    id: 'final-1',
    content: [{ type: 'Text', text: 'Checked the other host meanwhile.' }],
    phase: 'final_answer'
  }),
  {
    timestamp: '2026-09-06T17:01:39.724Z',
    type: 'event_msg',
    payload: { type: 'task_complete', turn_id: 'turn-1' }
  }
]
const USER_REPLY = item('2026-09-06T17:02:04.765Z', {
  type: 'UserMessage',
  id: 'user-2',
  content: [{ type: 'text', text: 'Moved' }]
})

function item(timestamp: string, value: unknown): unknown {
  return { timestamp, type: 'event_msg', payload: { type: 'item_completed', item: value } }
}

async function readFixture(records: unknown[]): Promise<NativeChatMessagesResult> {
  const root = await mkdtemp(join(tmpdir(), 'orca-native-chat-codex-async-'))
  tempRoots.push(root)
  const filePath = join(root, 'rollout.jsonl')
  await writeFile(filePath, records.map((record) => JSON.stringify(record)).join('\n'))
  const result = await readNativeChatTranscript('codex', 'session-1', { filePath })
  if (!('messages' in result)) {
    throw new Error('expected transcript messages')
  }
  return result
}
type NativeChatMessagesResult = { messages: Parameters<typeof extractPendingAsyncAsk>[0] }

describe('Codex async question transcript', () => {
  it('keeps the question answerable after the acknowledgement and the turn end', async () => {
    const { messages } = await readFixture(ROLLOUT)

    expect(extractPendingAsyncAsk(messages)).toEqual({
      questions: [
        {
          question: QUESTION,
          multiSelect: false,
          options: [{ label: 'Moved' }, { label: 'Not moved' }, { label: 'Unsure' }]
        }
      ]
    })
    // Never routed to the blocking card, whose answer is TUI keystrokes.
    expect(extractPendingAsk(messages)).toBeNull()
  })

  it('clears once the user replies with a follow-up message', async () => {
    const { messages } = await readFixture([...ROLLOUT, USER_REPLY])
    expect(extractPendingAsyncAsk(messages)).toBeNull()
  })
})
