// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentType, NativeChatMessage } from '../../../../shared/native-chat-types'
import type { NativeChatInteractiveSend } from './use-native-chat-interactive-send'

const state = vi.hoisted(
  (): {
    agentStatusByPaneKey: { pane: { interactivePrompt: string | undefined; toolName: undefined } }
  } => ({
    agentStatusByPaneKey: {
      pane: { interactivePrompt: undefined, toolName: undefined }
    }
  })
)
vi.mock('../../store', () => ({
  useAppStore: (selector: (store: typeof state) => unknown) => selector(state)
}))

import { NativeChatInteractiveCard } from './NativeChatInteractiveCard'
import { useNativeChatInteractivePromptCard } from './use-native-chat-interactive-prompt-card'
import { useNativeChatPromptCardPresentation } from './use-native-chat-prompt-card-presentation'
import { nativeChatPromptDismissals } from './native-chat-prompt-dismissals'
import { TooltipProvider } from '@/components/ui/tooltip'

const QUESTION = '请告诉我脚本放在哪个仓库。'
function messages(id = 'reply-1'): NativeChatMessage[] {
  return [
    {
      id,
      role: 'assistant',
      blocks: [{ type: 'text', text: QUESTION }],
      timestamp: null,
      source: 'transcript'
    }
  ]
}
const send = {
  sendAnswer: vi.fn<NativeChatInteractiveSend['sendAnswer']>(),
  sendMessage: vi.fn<NativeChatInteractiveSend['sendMessage']>(),
  sendRaw: vi.fn<NativeChatInteractiveSend['sendRaw']>(),
  sendRawVerified: vi.fn<NativeChatInteractiveSend['sendRawVerified']>(),
  cancelPending: vi.fn<NativeChatInteractiveSend['cancelPending']>(),
  cancelAsk: vi.fn<NativeChatInteractiveSend['cancelAsk']>(),
  cancel: vi.fn<NativeChatInteractiveSend['cancel']>()
}

function Pane({ id = 'reply-1' }: { id?: string }): React.JSX.Element | null {
  const card = useNativeChatInteractivePromptCard({
    paneKey: 'pane',
    messages: messages(id),
    transcriptSettled: true,
    agent: 'antigravity',
    awaitingInput: true
  })
  const presentation = useNativeChatPromptCardPresentation({
    paneKey: 'pane',
    targetPtyId: 'pty',
    card,
    canSend: true
  })
  const mounted = presentation.card ?? presentation.collapsedCard
  return (
    <TooltipProvider>
      {mounted ? (
        <div hidden={presentation.collapsedCard !== null}>
          <NativeChatInteractiveCard
            key={presentation.occurrenceKey}
            card={mounted}
            send={send}
            onDismiss={presentation.dismiss}
            onCollapse={presentation.collapse}
          />
        </div>
      ) : null}
      {presentation.collapsedCard ? <button onClick={presentation.expand}>Expand</button> : null}
    </TooltipProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  state.agentStatusByPaneKey.pane.interactivePrompt = undefined
  nativeChatPromptDismissals.clearForTests()
  send.sendAnswer.mockReturnValue({ settleAfterMs: 6000 })
})
afterEach(cleanup)

describe('Antigravity prose native question card', () => {
  it.each([
    ['antigravity', false, true],
    ['antigravity', true, false],
    ['codex', true, true],
    ['claude', true, true],
    ['cursor', true, true]
  ] satisfies [AgentType, boolean, boolean][])(
    'does not infer a prompt for agent=%s waiting=%s settled=%s',
    (agent, awaitingInput, transcriptSettled) => {
      const { result } = renderHook(() =>
        useNativeChatInteractivePromptCard({
          paneKey: 'pane',
          messages: messages(),
          agent,
          awaitingInput,
          transcriptSettled
        })
      )
      expect(result.current).toBeNull()
    }
  )

  it('does not replace a live permission prompt, including an unrecognised prompt', () => {
    state.agentStatusByPaneKey.pane.interactivePrompt = 'permission selector'
    render(<Pane />)
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument()
  })

  it('sends typed text through message delivery and waits before hiding the card', () => {
    render(<Pane />)
    const input = screen.getByPlaceholderText('Type your answer')
    fireEvent.change(input, { target: { value: '项目仓库的 tools 目录' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(send.sendAnswer).toHaveBeenCalledExactlyOnceWith(
      { questions: [{ question: QUESTION, multiSelect: false, options: [] }] },
      [{ indices: [], other: '项目仓库的 tools 目录' }],
      expect.any(Function),
      'message'
    )
    expect(screen.getByText(QUESTION)).toBeInTheDocument()
    expect(input).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(send.sendAnswer).toHaveBeenCalledOnce()
    act(() => send.sendAnswer.mock.calls[0]?.[2]?.(true))
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument()
    expect(send.sendRaw).not.toHaveBeenCalled()
  })

  it('preserves the answer on failed delivery and permits retry', () => {
    render(<Pane />)
    const input = screen.getByPlaceholderText('Type your answer')
    fireEvent.change(input, { target: { value: 'tools' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    act(() => send.sendAnswer.mock.calls[0]?.[2]?.(false))
    expect(input).toHaveValue('tools')
    expect(input).not.toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(send.sendAnswer).toHaveBeenCalledTimes(2)
  })

  it('keeps the draft through collapse and expansion', () => {
    render(<Pane />)
    fireEvent.change(screen.getByPlaceholderText('Type your answer'), {
      target: { value: 'tools' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(screen.getByPlaceholderText('Type your answer')).toHaveValue('tools')
    expect(send.sendAnswer).not.toHaveBeenCalled()
  })

  it('dismisses only this message across remounts without sending Escape', () => {
    const first = render(<Pane />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    first.unmount()
    const next = render(<Pane />)
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument()
    next.rerender(<Pane id="reply-2" />)
    expect(screen.getByText(QUESTION)).toBeInTheDocument()
    expect(send.cancelAsk).not.toHaveBeenCalled()
    expect(send.sendRaw).not.toHaveBeenCalled()
  })

  it('ignores late delivery after a new question takes over', () => {
    const view = render(<Pane />)
    fireEvent.change(screen.getByPlaceholderText('Type your answer'), {
      target: { value: 'tools' }
    })
    fireEvent.keyDown(screen.getByPlaceholderText('Type your answer'), { key: 'Enter' })
    view.rerender(<Pane id="reply-2" />)
    act(() => send.sendAnswer.mock.calls[0]?.[2]?.(true))
    expect(screen.getByText(QUESTION)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type your answer')).toHaveValue('')
    expect(send.cancelPending).toHaveBeenCalled()
  })
})
