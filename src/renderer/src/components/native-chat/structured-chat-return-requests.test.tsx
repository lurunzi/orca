// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionHandoffStatus } from '../../../../shared/agent-session-wire'
import {
  requestStructuredChatReturn,
  resetStructuredChatReturnRequestsForTests,
  STRUCTURED_CHAT_RETURN_REQUEST_TTL_MS,
  useStructuredChatReturnRequest
} from './structured-chat-return-requests'

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: vi.fn()
}))
vi.mock('@/runtime/structured-agent-session-host-capability', () => ({
  supportsStructuredAgentSessionHandoffControls: vi.fn()
}))

const TUI_OWNER: AgentSessionHandoffStatus = {
  owner: 'tui',
  direction: null,
  phase: 'idle',
  stage: null,
  operationId: null,
  terminal: { handle: 'term_1', tabId: 'tui-tab', paneKey: 'tui-tab:leaf', ptyId: 'pty-1' }
}
const SWITCHING: AgentSessionHandoffStatus = {
  owner: 'tui',
  direction: 'to-tui',
  phase: 'switching',
  stage: 'new-owner-proving',
  operationId: 'op'
}

function renderConsumer(status: AgentSessionHandoffStatus | null) {
  const request = vi.fn()
  const hook = renderHook(
    ({ current }: { current: AgentSessionHandoffStatus | null }) =>
      useStructuredChatReturnRequest({ sessionId: 'session-1', status: current, request }),
    { initialProps: { current: status } }
  )
  return {
    request,
    rerender: (next: AgentSessionHandoffStatus | null) => hook.rerender({ current: next })
  }
}

describe('useStructuredChatReturnRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    resetStructuredChatReturnRequestsForTests()
    vi.useRealTimers()
  })

  it('sends a terminal-side return once the Chat reads the terminal as idle owner', () => {
    const { request } = renderConsumer(TUI_OWNER)

    act(() =>
      requestStructuredChatReturn('session-1', { terminalTabId: 'tui-tab', ptyId: 'pty-1' })
    )

    expect(request).toHaveBeenCalledExactlyOnceWith('to-native', 'after-turn')
  })

  it('waits out a stale read and sends when the live owner arrives', () => {
    const { request, rerender } = renderConsumer(SWITCHING)
    act(() =>
      requestStructuredChatReturn('session-1', { terminalTabId: 'tui-tab', ptyId: 'pty-1' })
    )
    expect(request).not.toHaveBeenCalled()

    rerender(TUI_OWNER)

    expect(request).toHaveBeenCalledExactlyOnceWith('to-native', 'after-turn')
    rerender({ ...TUI_OWNER })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('leaves a session another terminal owns now', () => {
    const { request } = renderConsumer(TUI_OWNER)

    act(() =>
      requestStructuredChatReturn('session-1', { terminalTabId: 'old-tab', ptyId: 'pty-0' })
    )

    expect(request).not.toHaveBeenCalled()
  })

  it('expires a request no live owner ever confirms', () => {
    const { request, rerender } = renderConsumer(SWITCHING)
    act(() =>
      requestStructuredChatReturn('session-1', { terminalTabId: 'tui-tab', ptyId: 'pty-1' })
    )

    act(() => {
      vi.advanceTimersByTime(STRUCTURED_CHAT_RETURN_REQUEST_TTL_MS + 10)
    })
    rerender(TUI_OWNER)

    expect(request).not.toHaveBeenCalled()
  })

  it('ignores returns requested for other sessions', () => {
    const { request } = renderConsumer(TUI_OWNER)

    act(() =>
      requestStructuredChatReturn('session-2', { terminalTabId: 'tui-tab', ptyId: 'pty-1' })
    )

    expect(request).not.toHaveBeenCalled()
  })
})
