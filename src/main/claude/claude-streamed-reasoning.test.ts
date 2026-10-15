import { describe, expect, it } from 'vitest'
import { agentJournalItemKey } from '../../shared/agent-session-journal-item-key'
import type { AgentJournalItemBody } from '../../shared/agent-session-journal-types'
import type { StructuredAgentSessionAppendOptions } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { createClaudeJournalTranslator } from './claude-structured-journal-translation'

function harness() {
  const rows = new Map<
    string,
    { body: AgentJournalItemBody; options: StructuredAgentSessionAppendOptions }
  >()
  const translator = createClaudeJournalTranslator({
    sink: {
      appendItem: (identity, body, options) => {
        rows.set(agentJournalItemKey(identity), { body, options })
      },
      appendTombstone: (identity) => {
        rows.delete(agentJournalItemKey(identity))
      },
      publish: () => {}
    },
    schedule: () => () => {}
  })
  let sequence = 0
  const frame = (message: Record<string, unknown>) =>
    translator.handle({
      type: 'message',
      sessionId: 'orca',
      observedAt: ++sequence,
      message: {
        session_id: 'claude',
        uuid: `frame-${sequence}`,
        parent_tool_use_id: null,
        ...message
      }
    })
  const stream = (event: Record<string, unknown>, parent: string | null = null) =>
    frame({
      type: 'stream_event',
      parent_tool_use_id: parent,
      event
    })
  const start = (parent: string | null = null) =>
    stream(
      {
        type: 'message_start',
        message: { id: `message-${parent ?? 'root'}`, role: 'assistant', content: [] }
      },
      parent
    )
  const block = (index: number, type: 'thinking' | 'text', parent: string | null = null) =>
    stream(
      {
        type: 'content_block_start',
        index,
        content_block: type === 'thinking' ? { type, thinking: '' } : { type, text: '' }
      },
      parent
    )
  const delta = (
    index: number,
    type: 'thinking' | 'text',
    value: string,
    parent: string | null = null
  ) =>
    stream(
      {
        type: 'content_block_delta',
        index,
        delta:
          type === 'thinking'
            ? { type: 'thinking_delta', thinking: value }
            : { type: 'text_delta', text: value }
      },
      parent
    )
  const final = (content: unknown[], parent: string | null = null) =>
    frame({
      type: 'assistant',
      parent_tool_use_id: parent,
      message: { id: `message-${parent ?? 'root'}`, role: 'assistant', content }
    })
  const prose = () =>
    [...rows.entries()].flatMap(([id, { body, options }]) =>
      body.kind === 'message'
        ? [
            {
              id,
              role: body.role,
              text: body.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n'),
              options
            }
          ]
        : []
    )
  return { translator, frame, stream, start, block, delta, final, prose }
}

describe('Claude streamed reasoning', () => {
  it.each(['ended', 'result', 'dispose'] as const)(
    'retains partial reasoning on %s without a final envelope',
    (end) => {
      const h = harness()
      h.start()
      h.block(0, 'thinking')
      h.delta(0, 'thinking', 'Partial ')
      h.delta(0, 'thinking', 'reasoning')
      h.translator.flush()
      expect(h.prose()).toEqual([
        expect.objectContaining({ role: 'reasoning', text: 'Partial reasoning' })
      ])
      h.delta(0, 'thinking', ' retained')
      if (end === 'ended') {
        h.translator.handle({
          type: 'ended',
          sessionId: 'orca',
          reason: 'disconnected',
          observedAt: 10
        })
      } else if (end === 'dispose') {
        h.translator.dispose()
      } else {
        h.frame({
          type: 'result',
          subtype: 'success',
          is_error: false,
          duration_ms: 10,
          num_turns: 1,
          result: ''
        })
      }
      expect(h.prose()).toEqual([
        expect.objectContaining({ role: 'reasoning', text: 'Partial reasoning retained' })
      ])
      h.translator.dispose()
    }
  )

  it('reconciles the final thinking envelope onto the live row', () => {
    const h = harness()
    h.start()
    h.block(0, 'thinking')
    h.delta(0, 'thinking', 'Partial')
    h.translator.flush()
    const id = h.prose()[0]?.id
    h.final([{ type: 'thinking', thinking: 'Partial completed' }])
    h.translator.flush()
    expect(h.prose()).toEqual([
      expect.objectContaining({ id, role: 'reasoning', text: 'Partial completed' })
    ])
    expect(h.translator.pendingStreamedBlocks).toBe(0)
    h.translator.dispose()
  })

  it('keeps reasoning and text separate when their final envelopes arrive in another order', () => {
    const h = harness()
    h.start()
    h.block(0, 'thinking')
    h.delta(0, 'thinking', 'Reason')
    h.block(1, 'text')
    h.delta(1, 'text', 'Answer')
    h.translator.flush()
    const ids = h.prose().map((row) => row.id)
    h.final([{ type: 'text', text: 'Answer final' }])
    h.final([{ type: 'thinking', thinking: 'Reason final' }])
    expect(h.prose()).toEqual([
      expect.objectContaining({ id: ids[0], role: 'reasoning', text: 'Reason final' }),
      expect.objectContaining({ id: ids[1], role: 'assistant', text: 'Answer final' })
    ])
    expect(h.translator.pendingStreamedBlocks).toBe(0)
    h.translator.dispose()
  })

  it('reconciles a final envelope containing both reasoning and text', () => {
    const h = harness()
    h.start()
    h.block(0, 'thinking')
    h.delta(0, 'thinking', 'Reason')
    h.block(1, 'text')
    h.delta(1, 'text', 'Answer')
    h.final([
      { type: 'thinking', thinking: 'Reason final' },
      { type: 'text', text: 'Answer final' }
    ])
    expect(h.prose()).toHaveLength(2)
    expect(h.prose().map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'reasoning', text: 'Reason final' },
      { role: 'assistant', text: 'Answer final' }
    ])
    expect(h.translator.pendingStreamedBlocks).toBe(0)
    h.translator.dispose()
  })

  it('does not turn empty or signature-only thinking into a row or consume a text identity', () => {
    const h = harness()
    h.start()
    h.block(0, 'thinking')
    h.delta(0, 'thinking', '')
    h.stream({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'opaque' }
    })
    h.block(1, 'text')
    h.delta(1, 'text', 'Answer')
    h.final([{ type: 'thinking', thinking: '', signature: 'opaque' }])
    h.final([{ type: 'text', text: 'Answer final' }])
    expect(h.prose()).toEqual([
      expect.objectContaining({ role: 'assistant', text: 'Answer final' })
    ])
    h.translator.dispose()
  })

  it('preserves a partial block when its final thinking text is empty', () => {
    const h = harness()
    h.start()
    h.block(0, 'thinking')
    h.delta(0, 'thinking', 'Received fragment')
    h.final([{ type: 'thinking', thinking: '' }])
    expect(h.prose()).toEqual([
      expect.objectContaining({ role: 'reasoning', text: 'Received fragment' })
    ])
    expect(h.translator.pendingStreamedBlocks).toBe(0)
    h.translator.dispose()
  })

  it('keeps root and child reasoning identities and producers isolated', () => {
    const h = harness()
    h.start()
    h.block(0, 'thinking')
    h.delta(0, 'thinking', 'Root')
    h.start('child-tool')
    h.block(0, 'thinking', 'child-tool')
    h.delta(0, 'thinking', 'Child', 'child-tool')
    h.final([{ type: 'thinking', thinking: 'Child final' }], 'child-tool')
    h.final([{ type: 'thinking', thinking: 'Root final' }])
    const rows = h.prose().filter((row) => row.role === 'reasoning')
    expect(rows).toHaveLength(2)
    expect(h.prose().filter((row) => row.role === 'assistant')).toEqual([])
    expect(rows.find((row) => row.text === 'Root final')?.options.agentId).toBeUndefined()
    expect(rows.find((row) => row.text === 'Child final')?.options).toMatchObject({
      providerParentRef: 'child-tool'
    })
    h.translator.dispose()
  })

  it('accepts a reasoning delta when its block start is absent', () => {
    const h = harness()
    h.delta(0, 'thinking', 'Recovered fragment')
    h.final([{ type: 'thinking', thinking: 'Recovered fragment complete' }])
    expect(h.prose()).toEqual([
      expect.objectContaining({ role: 'reasoning', text: 'Recovered fragment complete' })
    ])
    h.translator.dispose()
  })

  it('reconciles two thinking blocks independently in the same message', () => {
    const h = harness()
    h.start()
    h.block(0, 'thinking')
    h.delta(0, 'thinking', 'First')
    h.block(1, 'thinking')
    h.delta(1, 'thinking', 'Second')
    h.final([{ type: 'thinking', thinking: 'First final' }])
    h.final([{ type: 'thinking', thinking: 'Second final' }])
    expect(h.prose().map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'reasoning', text: 'First final' },
      { role: 'reasoning', text: 'Second final' }
    ])
    expect(h.translator.pendingStreamedBlocks).toBe(0)
    h.translator.dispose()
  })

  it('preserves both roles on interruption and clears pending blocks at settlement', () => {
    const h = harness()
    h.start()
    h.block(0, 'text')
    h.delta(0, 'text', 'Partial answer')
    h.block(1, 'thinking')
    h.delta(1, 'thinking', 'Partial reasoning')
    expect(h.translator.pendingStreamedBlocks).toBe(2)
    h.frame({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '',
      duration_ms: 1,
      num_turns: 1
    })
    expect(h.prose().map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'assistant', text: 'Partial answer' },
      { role: 'reasoning', text: 'Partial reasoning' }
    ])
    expect(h.translator.pendingStreamedBlocks).toBe(0)
    h.translator.dispose()
  })

  it('does not reconcile a different provider message onto an unfinished thinking block', () => {
    const h = harness()
    h.start()
    h.block(0, 'thinking')
    h.delta(0, 'thinking', 'Original fragment')
    h.frame({
      type: 'assistant',
      message: {
        id: 'different-message',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'Different reasoning' }]
      }
    })
    expect(h.prose().map((row) => row.text)).toEqual(['Original fragment', 'Different reasoning'])
    expect(h.translator.pendingStreamedBlocks).toBe(1)
    h.translator.dispose()
  })
})
