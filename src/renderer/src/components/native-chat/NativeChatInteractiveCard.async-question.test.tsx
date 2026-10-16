// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock, NativeChatMessage } from '../../../../shared/native-chat-types'
import type { NativeChatInteractiveSend } from './use-native-chat-interactive-send'

const storeState = {
  agentStatusByPaneKey: {
    'tab-1:leaf-1': { interactivePrompt: undefined, toolName: undefined, state: 'working' }
  }
}

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: typeof storeState) => unknown) => selector(storeState)
}))

import { NativeChatInteractiveCard } from './NativeChatInteractiveCard'
import { useNativeChatInteractivePromptCard } from './use-native-chat-interactive-prompt-card'

const send = {
  sendAnswer: vi.fn<NativeChatInteractiveSend['sendAnswer']>(),
  sendMessage: vi.fn<NativeChatInteractiveSend['sendMessage']>(),
  sendRaw: vi.fn<NativeChatInteractiveSend['sendRaw']>(),
  sendRawVerified: vi.fn<NativeChatInteractiveSend['sendRawVerified']>(),
  cancelPending: vi.fn<NativeChatInteractiveSend['cancelPending']>(),
  cancelAsk: vi.fn<NativeChatInteractiveSend['cancelAsk']>(),
  cancel: vi.fn<NativeChatInteractiveSend['cancel']>()
}

const QUESTION = 'Was the backup disk moved?'

function message(id: string, role: NativeChatMessage['role'], blocks: NativeChatBlock[]) {
  return { id, role, blocks, timestamp: null, source: 'transcript' } satisfies NativeChatMessage
}

function asyncAsk(questions: unknown[]): NativeChatMessage[] {
  return [
    message('call', 'assistant', [
      {
        type: 'tool-call',
        name: 'request_user_input_async',
        input: JSON.stringify({ questions })
      }
    ]),
    message('ack', 'tool', [{ type: 'tool-result', output: '{"accepted":true}' }])
  ]
}

const WITH_OPTIONS = asyncAsk([{ title: QUESTION, options: ['Moved', 'Not moved'] }])

// The pane derives the card with the hook, then renders it; test that pair end to end.
function Pane({ messages }: { messages: readonly NativeChatMessage[] }): React.JSX.Element | null {
  const prompt = useNativeChatInteractivePromptCard({
    paneKey: 'tab-1:leaf-1',
    messages,
    transcriptSettled: true
  })
  const [dismissed, setDismissed] = useState(false)
  return prompt && !dismissed ? (
    <NativeChatInteractiveCard card={prompt} send={send} onDismiss={() => setDismissed(true)} />
  ) : null
}

function card(messages: readonly NativeChatMessage[]) {
  return <Pane messages={messages} />
}

describe('NativeChatInteractiveCard async Codex questions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    send.sendMessage.mockReturnValue(true)
  })

  afterEach(cleanup)

  it('renders an answerable card after the acknowledgement', () => {
    render(card(WITH_OPTIONS))

    expect(screen.getByText(QUESTION)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Not moved/ })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type your answer')).toBeInTheDocument()
  })

  it('answers with a follow-up chat message, never selector keystrokes', () => {
    render(card(WITH_OPTIONS))

    fireEvent.click(screen.getByRole('button', { name: /Not moved/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(send.sendMessage).toHaveBeenCalledExactlyOnceWith('Not moved')
    expect(send.sendAnswer).not.toHaveBeenCalled()
    expect(send.sendRaw).not.toHaveBeenCalled()
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument()
  })

  it('answers a title-only question with typed text', () => {
    render(card(asyncAsk([{ title: 'Any constraints?' }])))

    fireEvent.change(screen.getByPlaceholderText('Type your answer'), {
      target: { value: 'Keep it offline' }
    })
    fireEvent.keyDown(screen.getByPlaceholderText('Type your answer'), { key: 'Enter' })

    expect(send.sendMessage).toHaveBeenCalledExactlyOnceWith('Keep it offline')
  })

  it('keeps the card when the message could not be sent', () => {
    send.sendMessage.mockReturnValue(false)
    render(card(WITH_OPTIONS))

    fireEvent.click(screen.getByRole('button', { name: /Moved/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(screen.getByText(QUESTION)).toBeInTheDocument()
  })

  it('dismisses locally without interrupting the still-running agent', () => {
    render(card(WITH_OPTIONS))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument()
    expect(send.cancel).not.toHaveBeenCalled()
    expect(send.sendRaw).not.toHaveBeenCalled()
  })

  it('shows no card for plain assistant prose', () => {
    render(card([message('prose', 'assistant', [{ type: 'text', text: `${QUESTION}\n- Moved` }])]))

    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })
})
