// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type { NativeChatSessionTransport } from './native-chat-session-transport'
import { installNativeChatMessageListTestViewport } from './native-chat-message-list-test-viewport'

type FrameHandler = Parameters<NativeChatSessionTransport['subscribe']>[1]
const mocks = vi.hoisted(() => {
  const stream: { frame: FrameHandler | null } = { frame: null }
  return { ...stream, read: vi.fn(), unsubscribe: vi.fn(), transport: vi.fn() }
})
vi.mock('./native-chat-session-transport', () => ({
  getNativeChatSessionTransport: (owner: string | null) => {
    mocks.transport(owner)
    return {
      readSession: mocks.read,
      subscribe: (_args: unknown, onFrame: FrameHandler) => {
        mocks.frame = onFrame
        return mocks.unsubscribe
      }
    }
  }
}))
vi.mock('./native-chat-image-runtime-context', () => ({
  useNativeChatImageRuntimeContext: () => null
}))
import { NativeChatTranscriptView } from './NativeChatTranscriptView'
const source = {
  agent: 'cursor' as const,
  sessionId: 'worker',
  transcriptPath: '/cursor/worker.jsonl',
  runtimeEnvironmentId: 'worker-host'
}
const message = (id: string, text: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text }],
  timestamp: 1,
  source: 'transcript'
})
let restoreViewport = (): void => {}
beforeEach(() => {
  vi.clearAllMocks()
  restoreViewport = installNativeChatMessageListTestViewport()
  mocks.read.mockResolvedValue({
    messages: [message('one', 'Visible worker response')],
    hasMore: false
  })
})
afterEach(() => {
  cleanup()
  restoreViewport()
})

it('renders the body, follows append frames and never offers worker input', async () => {
  const view = render(
    <NativeChatTranscriptView tabId="worker-tab" source={source} isVisible isFocusedGroup />
  )
  expect(await screen.findByText('Visible worker response')).toBeVisible()
  expect(mocks.transport).toHaveBeenCalledWith('worker-host')
  expect(mocks.read).toHaveBeenCalledWith(
    'cursor',
    'worker',
    expect.any(Number),
    source.transcriptPath
  )
  await act(async () => {
    mocks.frame?.({ type: 'appended', messages: [message('two', 'Next worker response')] })
  })
  expect(await screen.findByText('Next worker response')).toBeVisible()
  expect(view.container.querySelector('textarea, [contenteditable="true"]')).toBeNull()
  view.rerender(
    <NativeChatTranscriptView
      tabId="worker-tab"
      source={source}
      isVisible={false}
      isFocusedGroup={false}
    />
  )
  expect(mocks.unsubscribe).toHaveBeenCalledOnce()
})

it('surfaces a read error instead of an indefinite loading page', async () => {
  mocks.read.mockResolvedValue({ error: 'Transcript unavailable on worker host' })
  render(<NativeChatTranscriptView tabId="worker-tab" source={source} isVisible isFocusedGroup />)
  expect(await screen.findByText('Transcript unavailable on worker host')).toBeVisible()
})
