// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type { NativeChatSessionTransport } from './native-chat-session-transport'
import { installNativeChatMessageListTestViewport } from './native-chat-message-list-test-viewport'

type FrameHandler = Parameters<NativeChatSessionTransport['subscribe']>[1]
const mocks = vi.hoisted(() => {
  const stream: { frame: FrameHandler | null } = { frame: null }
  return {
    ...stream,
    read: vi.fn(),
    unsubscribe: vi.fn(),
    transport: vi.fn(),
    terminal: vi.fn(),
    resume: { resumable: false, resume: vi.fn() }
  }
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
vi.mock('./use-cursor-transcript-resume', () => ({
  useCursorTranscriptResume: () => mocks.resume
}))
vi.mock('@/lib/cursor-transcript-terminal', () => ({
  findCursorTranscriptTerminal: mocks.terminal
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getKnownExecutionHostIdForWorktree: () => 'runtime:worker-host'
}))
vi.mock('./NativeChatResolvedView', () => ({
  NativeChatResolvedView: () => <div>Managed chat</div>
}))
vi.mock('./native-chat-image-runtime-context', () => ({
  useNativeChatImageRuntimeContext: () => null
}))
import { NativeChatTranscriptView } from './NativeChatTranscriptView'
import {
  clearNativeChatComposerDraftsForTests,
  readNativeChatComposerDraft,
  updateNativeChatComposerDraft
} from './native-chat-composer-draft-store'
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
  clearNativeChatComposerDraftsForTests()
  mocks.terminal.mockReturnValue(null)
  mocks.resume.resumable = false
  mocks.resume.resume.mockResolvedValue(true)
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

it('keeps an editable draft with the transcript while switching away and back', async () => {
  const view = render(
    <NativeChatTranscriptView
      tabId="worker-tab"
      worktreeId="wt"
      source={source}
      isVisible
      isFocusedGroup
    />
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
  expect(screen.getByRole('textbox')).toHaveAttribute('contenteditable', 'true')
  view.rerender(
    <NativeChatTranscriptView
      tabId="worker-tab"
      worktreeId="wt"
      source={source}
      isVisible={false}
      isFocusedGroup={false}
    />
  )
  expect(mocks.unsubscribe).toHaveBeenCalledOnce()
})

it('surfaces a read error instead of an indefinite loading page', async () => {
  mocks.read.mockResolvedValue({ error: 'Transcript unavailable on worker host' })
  render(
    <NativeChatTranscriptView
      tabId="worker-tab"
      worktreeId="wt"
      source={source}
      isVisible
      isFocusedGroup
    />
  )
  expect(await screen.findByText('Transcript unavailable on worker host')).toBeVisible()
})

it('waits for delivery before switching to the newly bound terminal composer', async () => {
  let finish: (sent: boolean) => void = () => undefined
  mocks.resume.resumable = true
  mocks.resume.resume.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve
      })
  )
  updateNativeChatComposerDraft('worker-tab', { text: 'continue once' }, 'immediate')
  const props = {
    tabId: 'worker-tab',
    worktreeId: 'wt',
    source,
    isVisible: true,
    isFocusedGroup: true
  }
  const view = render(<NativeChatTranscriptView {...props} />)
  await screen.findByText('Visible worker response')
  fireEvent.click(screen.getByRole('button', { name: /Resume and send/ }))
  mocks.terminal.mockReturnValue({ tabId: 'managed', paneKey: 'managed:leaf', ptyId: 'pty' })
  view.rerender(<NativeChatTranscriptView {...props} />)
  expect(screen.queryByText('Managed chat')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Resume and send/ })).toBeDisabled()
  await act(async () => finish(true))
  expect(await screen.findByText('Managed chat')).toBeVisible()
  expect(readNativeChatComposerDraft('worker-tab').text).toBe('')
  expect(mocks.resume.resume).toHaveBeenCalledExactlyOnceWith('continue once')
})

it('shows the input before resume lookup finishes and enables send once the exact session resolves', async () => {
  const view = render(
    <NativeChatTranscriptView
      tabId="worker-tab"
      worktreeId="wt"
      source={source}
      isVisible
      isFocusedGroup
    />
  )
  await screen.findByText('Visible worker response')
  expect(screen.getByRole('button', { name: /Resume and send/ })).toBeDisabled()
  mocks.resume.resumable = true
  view.rerender(
    <NativeChatTranscriptView
      tabId="worker-tab"
      worktreeId="wt"
      source={source}
      isVisible
      isFocusedGroup
    />
  )
  expect(screen.getByRole('textbox')).toHaveAttribute('contenteditable', 'true')
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  expect(mocks.resume.resume).not.toHaveBeenCalled()
})
