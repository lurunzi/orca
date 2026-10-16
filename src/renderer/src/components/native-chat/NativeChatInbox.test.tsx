// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  AgentJournalRenderItem,
  AgentJournalToolCallState
} from '../../../../shared/agent-session-journal-types'
import {
  sessionInboxItemId,
  sessionInboxToolName
} from '../../../../shared/session-inbox-tool-contract'
import { NativeChatInboxButton } from './NativeChatInboxButton'
import { readNativeChatInboxMarks, resetNativeChatInboxMarksCache } from './native-chat-inbox-marks'
import { useNativeChatInbox } from './use-native-chat-inbox'

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: vi.fn()
}))

let sequence = 0
function item(body: AgentJournalRenderItem['body']): AgentJournalRenderItem {
  sequence += 1
  return { itemId: `item-${sequence}`, sequence, revision: 1, observedAt: Date.now(), body }
}
function tool(
  name: string,
  input: unknown,
  state: AgentJournalToolCallState = 'completed',
  output = ''
): AgentJournalRenderItem {
  return item({
    kind: 'tool-call',
    name,
    input,
    state,
    output: { head: output, byteLength: output.length, digest: 'd', truncated: false }
  })
}

const opener = item({ kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'Fix it' }] })
const ITEMS = [
  opener,
  tool(sessionInboxToolName('record_question'), {
    question: 'Ship the migration today?',
    options: ['Yes, today', 'Wait for review'],
    recommended: 'Wait for review'
  }),
  tool(sessionInboxToolName('record_finding'), {
    kind: 'issue',
    title: 'Retry loop never gives up',
    detail: 'It spins forever on a 401.',
    path: 'src/net/retry.ts'
  }),
  tool(
    'Bash',
    { command: 'pnpm vitest run' },
    'failed',
    'Exit code 1\n × sum adds every value\n Tests  1 failed | 11 passed (12)'
  )
]
const SCOPE = 'local:session-1'

const calls = { send: vi.fn(() => true), insert: vi.fn(() => true), jump: vi.fn() }

function Harness({ epoch }: { epoch?: string } = {}): React.JSX.Element {
  const inbox = useNativeChatInbox({
    enabled: true,
    sessionId: 'session-1',
    epoch,
    target: { kind: 'local' },
    journalItems: ITEMS,
    hasOlder: false,
    isWorking: false,
    root: '/repo',
    send: calls.send,
    insertIntoComposer: calls.insert,
    jumpToMessage: calls.jump
  })
  return (
    <TooltipProvider>
      <NativeChatInboxButton inbox={inbox} agentLabel="Claude" />
    </TooltipProvider>
  )
}

function openInbox(): HTMLElement {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Inbox, 2 waiting on you' }))
  return screen.getByRole('dialog', { name: 'Inbox' })
}

beforeEach(() => {
  localStorage.clear()
  resetNativeChatInboxMarksCache()
})

afterEach(() => {
  cleanup()
  calls.send.mockClear()
  calls.insert.mockClear()
  calls.jump.mockClear()
})

describe('NativeChatInbox', () => {
  it('does not carry an answered mark across a journal rewind', () => {
    const { rerender } = render(<Harness epoch="before" />)
    fireEvent.click(screen.getByRole('button', { name: 'Inbox, 2 waiting on you' }))
    fireEvent.click(screen.getByRole('button', { name: 'Answer: Wait for review' }))
    expect(screen.queryByText('Ship the migration today?')).toBeNull()
    rerender(<Harness epoch="after" />)
    expect(screen.getByText('Ship the migration today?')).toBeTruthy()
  })

  it('counts what waits on the user and lists questions, failing checks and findings', () => {
    const panel = openInbox()

    expect(within(panel).getByText('Ship the migration today?')).toBeTruthy()
    expect(within(panel).getByText('Claude recommends: Wait for review')).toBeTruthy()
    expect(within(panel).getByText(/Tests 1 failed \| 11 passed \(12\)/)).toBeTruthy()
    expect(within(panel).getByText('Retry loop never gives up')).toBeTruthy()
    expect(within(panel).getByText('src/net/retry.ts')).toBeTruthy()
  })

  it('answers a question as the user, by its id, and stops counting it', () => {
    const panel = openInbox()

    fireEvent.click(within(panel).getByRole('button', { name: 'Answer: Wait for review' }))

    const id = sessionInboxItemId('question', 'Ship the migration today?')
    expect(calls.send).toHaveBeenCalledWith(
      `My answer to your question ${id} ("Ship the migration today?"): Wait for review`
    )
    expect(screen.queryByText('Ship the migration today?')).toBeNull()
    expect(screen.getByText('1 waiting on you')).toBeTruthy()
  })

  it('asks for a fix and keeps the check listed as requested, no longer waiting on the user', () => {
    const panel = openInbox()

    fireEvent.click(within(panel).getByRole('button', { name: 'Ask to fix' }))

    expect(calls.send).toHaveBeenCalledWith(expect.stringContaining('failed when you last ran it.'))
    expect(within(panel).getByText('Fix requested')).toBeTruthy()
    expect(screen.getByText('1 waiting on you')).toBeTruthy()
  })

  it('remembers a dismissed finding for this session on this host', () => {
    const panel = openInbox()
    const row = within(panel).getByText('Retry loop never gives up').closest('li')
    if (!row) {
      throw new Error('no finding row')
    }

    fireEvent.click(within(row).getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByText('Retry loop never gives up')).toBeNull()
    resetNativeChatInboxMarksCache()
    expect(
      readNativeChatInboxMarks(SCOPE).get(
        `finding:${sessionInboxItemId('finding', 'Retry loop never gives up')}`
      )
    ).toBe('dismissed')
    expect(readNativeChatInboxMarks('environment:remote-1:session-1').size).toBe(0)
  })

  it('jumps to the turn the entry came from and closes the panel', () => {
    const panel = openInbox()
    const row = within(panel).getByText('Retry loop never gives up').closest('li')
    if (!row) {
      throw new Error('no finding row')
    }

    act(() => {
      fireEvent.click(within(row).getByRole('button', { name: 'Go to turn' }))
    })

    expect(calls.jump).toHaveBeenCalledWith(opener.itemId)
    expect(screen.queryByRole('dialog', { name: 'Inbox' })).toBeNull()
  })
})
