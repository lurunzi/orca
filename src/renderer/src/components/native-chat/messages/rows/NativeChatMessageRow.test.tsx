// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../actions/native-chat-tooltip-test-harness'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Why: these fixtures have neither inline visual owners nor sender navigation.
const unusedChatLeaves = vi.hoisted(() => ({
  inlineVisual: vi.fn(() => {
    throw new Error('Unexpected inline visual in transcript fixture')
  }),
  openSender: vi.fn(() => {
    throw new Error('Unexpected sender navigation in transcript fixture')
  })
}))
vi.mock('../../media/visuals/NativeChatInlineVisual', () => ({
  NativeChatInlineVisual: unusedChatLeaves.inlineVisual
}))
vi.mock('@/lib/agent-session/open/open-agent-message-sender', () => ({
  openAgentMessageSender: unusedChatLeaves.openSender
}))
afterEach(() => {
  expect(unusedChatLeaves.inlineVisual).not.toHaveBeenCalled()
  expect(unusedChatLeaves.openSender).not.toHaveBeenCalled()
})
import { MessageRow } from './NativeChatMessageRow'

const confirm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/syntax-highlighting/oniguruma', async () => ({
  loadOniguruma: (await import('@/lib/syntax-highlighting/oniguruma-test-harness'))
    .loadNodeOniguruma
}))
vi.mock('@/components/confirmation-dialog-context', () => ({
  useConfirmationDialog: () => confirm
}))

afterEach(cleanup)

describe('MessageRow control visibility', () => {
  it.each(['[Image #1] 顺便把worktree清理了', '[Image #1]'])(
    'hides sent image prefixes in the bubble: %s',
    (text) => {
      render(
        <MessageRow
          message={{
            id: 'image-message',
            role: 'user',
            timestamp: 0,
            source: 'transcript',
            blocks: [
              { type: 'text', text },
              { type: 'image-ref', path: '/tmp/screenshot.png', alt: 'Screenshot' }
            ]
          }}
          expandSignal={false}
          onScrollMessageToTop={vi.fn()}
        />
      )
      expect(screen.queryByText(/\[Image #1\]/)).toBeNull()
      expect(screen.getByTitle('Screenshot')).toBeInTheDocument()
      if (text.includes('顺便')) {
        expect(screen.getByText('顺便把worktree清理了')).toBeInTheDocument()
      } else {
        expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull()
      }
    }
  )

  it('draws and copies a user message without the [Image #N] its send wrote mid-sentence', async () => {
    const writeClipboardText = vi.fn().mockResolvedValue(undefined)
    Object.assign(window, { api: { ui: { writeClipboardText } } })

    render(
      <MessageRow
        message={{
          id: 'message',
          role: 'user',
          timestamp: 0,
          source: 'transcript',
          blocks: [
            { type: 'text', text: 'Compare this [Image #1] with the old one' },
            { type: 'image-ref', path: '/tmp/screenshot.png', alt: 'Screenshot' }
          ]
        }}
        expandSignal={false}
        onScrollMessageToTop={vi.fn()}
      />
    )
    expect(screen.queryByText(/\[Image #1\]/)).toBeNull()
    expect(screen.getByText(/Compare this\s+with the old one/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))
    await waitFor(() => {
      expect(writeClipboardText).toHaveBeenCalledWith(expect.not.stringContaining('[Image #1]'))
    })
  })
})
