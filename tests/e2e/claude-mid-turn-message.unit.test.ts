import { describe, expect, it } from 'vitest'
import {
  pendingSendsAsMessages,
  prunePendingSends,
  type NativeChatPendingSend
} from '../../src/renderer/src/components/native-chat/native-chat-pending'
import { decodeClaudeTranscriptLine } from '../../src/main/native-chat/transcript-line-decoders-claude'
import { decodeClaudeTurnLifecycle } from '../../src/main/native-chat/transcript-turn-lifecycle'

// Observed in Claude Code 2.1.278 after absorbed_mid_turn; text and identifiers are anonymized.
const queuedCommand = {
  type: 'queued_command',
  prompt: 'Check the result while you continue.',
  source_uuid: 'queued-source',
  commandMode: 'prompt',
  origin: { kind: 'human' },
  timestamp: '2026-09-22T19:37:59.013Z',
  humanTurn: true
}
const attachmentRecord = {
  type: 'attachment',
  uuid: 'queued-attachment',
  timestamp: queuedCommand.timestamp,
  attachment: queuedCommand,
  rendered: [
    { content: '<system-reminder>Harness wrapper, not the user message.</system-reminder>' }
  ]
}

describe('Claude human messages absorbed into a running turn', () => {
  it('decodes the authoritative attachment as the original user message', () => {
    expect(decodeClaudeTranscriptLine(JSON.stringify(attachmentRecord), 'fallback')).toEqual({
      id: attachmentRecord.uuid,
      role: 'user',
      blocks: [{ type: 'text', text: queuedCommand.prompt }],
      timestamp: Date.parse(queuedCommand.timestamp),
      source: 'transcript'
    })
  })

  it('reconciles the pending echo without resending or starting a new turn', () => {
    const line = JSON.stringify(attachmentRecord)
    const delivered = decodeClaudeTranscriptLine(line, 'fallback')
    const answer = decodeClaudeTranscriptLine(
      JSON.stringify({
        type: 'assistant',
        uuid: 'continued-answer',
        timestamp: '2026-09-22T19:38:20.000Z',
        message: {
          content: [{ type: 'text', text: 'I checked the result.' }],
          stop_reason: 'end_turn'
        }
      }),
      'answer-fallback'
    )
    expect(delivered).not.toBeNull()
    expect(answer).not.toBeNull()
    if (!delivered || !answer) {
      throw new Error('Expected both transcript records to decode')
    }
    const pending: NativeChatPendingSend[] = [
      {
        id: 'optimistic-send',
        text: queuedCommand.prompt,
        sentAt: Date.parse(queuedCommand.timestamp),
        afterMessageId: null
      }
    ]
    expect(pendingSendsAsMessages(pending, [delivered])).toEqual([])
    expect(prunePendingSends(pending, [delivered, answer])).toEqual([])
    expect(decodeClaudeTurnLifecycle(line, 'fallback')).toBeNull()
  })

  it.each([
    { type: 'task_notification' },
    { commandMode: 'bash' },
    { origin: { kind: 'agent' } },
    { origin: undefined },
    { humanTurn: false },
    { humanTurn: undefined },
    { prompt: '' },
    { prompt: '  ' },
    { prompt: null }
  ])('does not promote unsupported or non-human attachments: %j', (patch) => {
    const line = JSON.stringify({
      ...attachmentRecord,
      attachment: { ...queuedCommand, ...patch }
    })
    expect(decodeClaudeTranscriptLine(line, 'fallback')).toBeNull()
  })

  it.each(['enqueue', 'dequeue', 'remove'])('does not treat queue %s as delivery', (operation) => {
    const line = JSON.stringify({
      type: 'queue-operation',
      operation,
      content: queuedCommand.prompt,
      reason: 'absorbed_mid_turn'
    })
    expect(decodeClaudeTranscriptLine(line, 'fallback')).toBeNull()
  })

  it('keeps repeated messages distinct and preserves multiline content', () => {
    const prompt = 'First line\n  second line\n'
    const messages = ['first-attachment', 'second-attachment'].map((uuid) =>
      decodeClaudeTranscriptLine(
        JSON.stringify({ ...attachmentRecord, uuid, attachment: { ...queuedCommand, prompt } }),
        'fallback'
      )
    )
    expect(messages.map((message) => message?.id)).toEqual([
      'first-attachment',
      'second-attachment'
    ])
    expect(messages.map((message) => message?.blocks)).toEqual([
      [{ type: 'text', text: prompt }],
      [{ type: 'text', text: prompt }]
    ])
  })
})
