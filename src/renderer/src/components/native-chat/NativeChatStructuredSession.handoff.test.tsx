// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

const { mocks, moduleFactories, resetStructuredSessionMocks } = await vi.hoisted(async () =>
  (await import('./NativeChatStructuredSession.test-harness')).createStructuredSessionMocks()
)

vi.mock('@/lib/structured-agent-session-launch', () =>
  moduleFactories.structuredAgentSessionLaunch()
)
vi.mock('@/runtime/structured-agent-session-client', () =>
  moduleFactories.structuredAgentSessionClient()
)
vi.mock('./use-structured-agent-session', () => moduleFactories.useStructuredAgentSession())
vi.mock('./use-native-chat-font-scale', () => moduleFactories.useNativeChatFontScale())
vi.mock('./use-native-chat-file-link-context', () => moduleFactories.useNativeChatFileLinkContext())
vi.mock('./use-native-chat-file-link-click', () => moduleFactories.useNativeChatFileLinkClick())
vi.mock('./NativeChatMessageList', () => moduleFactories.nativeChatMessageList())
vi.mock('./NativeChatComposer', () => moduleFactories.nativeChatComposer())
vi.mock('./NativeChatEmptyState', () => moduleFactories.nativeChatEmptyState())
vi.mock('./NativeChatApprovalCard', () => moduleFactories.nativeChatApprovalCard())
vi.mock('./NativeChatQuestionCard', () => moduleFactories.nativeChatQuestionCard())

import { NativeChatStructuredSession } from './NativeChatStructuredSession'

function renderSession(): void {
  render(
    <TooltipProvider>
      <NativeChatStructuredSession
        isVisible
        isFocusedGroup
        tabId="structured-tab-handoff"
        sessionId="session-handoff"
        target={{ kind: 'local' }}
        agent="claude"
      />
    </TooltipProvider>
  )
}

describe('NativeChatStructuredSession chat/terminal switching', () => {
  afterEach(() => {
    cleanup()
    resetStructuredSessionMocks()
  })

  it('adds no row and no toggle while the host offers no handoff controls', () => {
    renderSession()

    expect(screen.queryByRole('button', { name: 'Open agent TUI' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Return to chat' })).toBeNull()
  })

  it('opens the agent terminal from the top-right toggle of a chat-owned session', () => {
    mocks.handoffStatus = {
      owner: 'native',
      direction: null,
      phase: 'idle',
      stage: null,
      operationId: null
    }
    renderSession()

    fireEvent.click(screen.getByRole('button', { name: 'Open agent TUI' }))

    expect(mocks.requestHandoff).toHaveBeenCalledWith('to-tui', 'after-turn')
  })

  it('returns a terminal-owned session to chat', () => {
    mocks.handoffStatus = {
      owner: 'tui',
      direction: null,
      phase: 'idle',
      stage: null,
      operationId: null,
      hostLabel: 'workstation'
    }
    renderSession()

    expect(screen.getByText('Agent is open in terminal on workstation.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open agent TUI' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Return to chat' }))

    expect(mocks.requestHandoff).toHaveBeenCalledWith('to-native', 'after-turn')
  })

  it('releases a stuck reservation only after the user confirms', async () => {
    mocks.handoffStatus = {
      owner: 'none',
      direction: 'to-native',
      phase: 'failed',
      stage: 'manual-recovery',
      operationId: null,
      error: {
        message: 'manual recovery is required',
        recoverableOwner: 'none',
        releaseFence: 9
      }
    }
    renderSession()

    fireEvent.click(screen.getByRole('button', { name: 'Release session' }))
    expect(mocks.releaseReservation).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    const confirm = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Release session'
    )
    fireEvent.click(confirm!)

    await waitFor(() => expect(mocks.releaseReservation).toHaveBeenCalledTimes(1))
  })

  it('offers no release for a failure the host did not mark releasable', () => {
    mocks.handoffStatus = {
      owner: 'none',
      direction: 'to-tui',
      phase: 'failed',
      stage: 'manual-recovery',
      operationId: null,
      error: { message: 'manual recovery is required', recoverableOwner: 'none' }
    }
    renderSession()

    expect(screen.getByRole('alert').textContent).toContain('manual recovery is required')
    expect(screen.queryByRole('button', { name: 'Release session' })).toBeNull()
  })
})
