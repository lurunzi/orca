import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../../../../shared/native-chat/native-chat-types'
import type { NativeChatTurnStatus } from '../../../../../../shared/native-chat/transcript/turns/native-chat-turn-status'
import type { NativeChatResolvedPrompt } from '../../../../../../shared/native-chat/input/questions/native-chat-resolution-receipt'
import type { NativeChatTurnDiff } from '../../../../../../shared/native-chat/tools/native-chat-turn-diffs'
import { createNativeChatMessageListProjection } from '../projection/native-chat-message-list-projection'
import {
  buildNativeChatTranscriptSlots,
  type NativeChatMessageSlot
} from './native-chat-transcript-slots'

const NO_STATUSES = { active: null, completedByTurn: {} }

function text(id: string, body: string, role: NativeChatMessage['role'] = 'assistant') {
  return {
    id,
    role,
    blocks: [{ type: 'text' as const, text: body }],
    timestamp: 1,
    source: 'transcript' as const
  }
}

function build(
  messages: NativeChatMessage[],
  overrides: Partial<Parameters<typeof buildNativeChatTranscriptSlots>[0]> = {}
): NativeChatMessageSlot[] {
  let turn: string | undefined
  const turnKeys = messages.map((message) => {
    if (message.role === 'user') {
      turn = message.id
    }
    return turn
  })
  return buildNativeChatTranscriptSlots({
    messages,
    turnKeys,
    liveTurnKey: undefined,
    receipts: new Map<string, NativeChatResolvedPrompt>(),
    turnStatuses: NO_STATUSES,
    turnDiffs: new Map<string, NativeChatTurnDiff>(),
    expandedTurnKeys: new Set<string>(),
    isWorking: false,
    lifecycleWorking: false,
    ...overrides
  }).filter((slot): slot is NativeChatMessageSlot => slot.kind === 'message')
}

function toolRun(id: string): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'tool-call', name: 'shell', input: { command: 'ls' }, state: 'completed' }],
    timestamp: 1,
    source: 'transcript'
  }
}

describe('a message from another session', () => {
  // Recorded shape: the prompt's answer settles, then another Claude session sends
  // a message the agent answers. The delivery is hidden, so both replies share the
  // prompt's turn — and the earlier answer must not fold behind the later one.
  it('keeps the answer from before the delivery on screen', () => {
    const at = (message: NativeChatMessage, timestamp: number) => ({ ...message, timestamp })
    const { conversation: messages, replyStartIds } = createNativeChatMessageListProjection()([
      at(text('prompt', 'Write a handoff', 'user'), 1),
      at(text('think-1', 'Planning', 'reasoning'), 2),
      at(text('handoff', '````md\n```sh\nnpm ci\n```\n````'), 3),
      at(
        text(
          'delivery',
          'Another Claude session sent a message: <cross-session-message from="uds:peer">Swap the JAR?</cross-session-message>',
          'user'
        ),
        4
      ),
      at(text('think-2', 'Checking claims', 'reasoning'), 5),
      at(toolRun('send'), 6),
      at(text('reply', 'No conflict, go ahead.'), 7)
    ])
    const status: NativeChatTurnStatus = { startedAt: 1, thinking: false, workedSeconds: 30 }
    const slots = build(messages, {
      turnStatuses: { active: null, completedByTurn: { prompt: status } },
      replyStartIds
    })
    const visible = slots.filter((slot) => !slot.folded).map((slot) => slot.message.id)
    expect(visible).toEqual(['prompt', 'handoff', 'reply'])
  })
})
