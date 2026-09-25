// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as StructuredTuiOwnerResolutionModule from '../native-chat/structured-tui-owner-resolution'
import type { StructuredTuiOwnerResolution } from '../native-chat/structured-tui-owner-resolution'
import { useStructuredTuiOwnerReturn } from './use-structured-tui-owner-return'

const mocks = vi.hoisted(() => {
  const unifiedTabsByWorktree: Record<string, unknown[]> = {}
  return {
    state: { unifiedTabsByWorktree },
    resolve: vi.fn(),
    activate: vi.fn(() => true),
    requestReturn: vi.fn()
  }
})

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: () => null
}))
vi.mock('@/runtime/runtime-rpc-client', () => ({
  getActiveRuntimeTarget: () => ({ kind: 'local' })
}))
vi.mock('@/lib/structured-agent-session-tab-activation', () => ({
  activateStructuredAgentSessionTab: mocks.activate
}))
vi.mock('../native-chat/structured-chat-return-requests', () => ({
  requestStructuredChatReturn: mocks.requestReturn
}))
vi.mock('../native-chat/structured-tui-owner-resolution', async (importOriginal) => ({
  ...(await importOriginal<typeof StructuredTuiOwnerResolutionModule>()),
  resolveStructuredTuiOwner: mocks.resolve
}))

const LEAF = '11111111-1111-4111-8111-111111111111'
const SIBLING_LEAF = '22222222-2222-4222-8222-222222222222'
const OWNER: StructuredTuiOwnerResolution = {
  kind: 'owner',
  binding: {
    sessionId: 'session-1',
    chatTabId: 'chat-tab',
    paneKey: `tui-tab:${LEAF}`,
    ptyId: 'pty-1'
  }
}

function chatTab(id: string, sessionId: string) {
  return { id, entityId: sessionId, contentType: 'agent-session', agentSessionAgent: 'claude' }
}

function renderOwnerReturn(enabled = true) {
  const panes = [
    { id: 1, leafId: LEAF },
    { id: 2, leafId: SIBLING_LEAF }
  ]
  const managerRef = { current: { getPanes: () => panes } }
  const paneTransportsRef = {
    current: new Map([
      [1, { getPtyId: () => 'pty-1' }],
      [2, { getPtyId: () => 'pty-2' }]
    ])
  }
  return renderHook(() =>
    useStructuredTuiOwnerReturn({
      worktreeId: 'wt-1',
      tabId: 'tui-tab',
      enabled,
      paneCount: panes.length,
      managerRef,
      paneTransportsRef
    })
  )
}

describe('useStructuredTuiOwnerReturn', () => {
  beforeEach(() => {
    mocks.state.unifiedTabsByWorktree = { 'wt-1': [chatTab('chat-tab', 'session-1')] }
    mocks.resolve.mockReset()
    mocks.activate.mockClear()
    mocks.requestReturn.mockClear()
  })
  afterEach(cleanup)

  it('owns only the pane the host names, and hands it back to its Chat', async () => {
    mocks.resolve.mockResolvedValue(OWNER)
    const { result } = renderOwnerReturn()

    await waitFor(() => expect(result.current.ownsLeaf(LEAF)).toBe(true))
    expect(result.current.ownsLeaf(SIBLING_LEAF)).toBe(false)
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [{ chatTabId: 'chat-tab', sessionId: 'session-1' }],
        terminal: { tabId: 'tui-tab', ptyIds: ['pty-1', 'pty-2'] }
      })
    )

    let returned = false
    await act(async () => {
      returned = await result.current.returnLeafToChat(LEAF)
    })

    expect(returned).toBe(true)
    expect(mocks.requestReturn).toHaveBeenCalledWith('session-1', {
      terminalTabId: 'tui-tab',
      ptyId: 'pty-1'
    })
    expect(mocks.activate).toHaveBeenCalledWith({ worktreeId: 'wt-1', tabId: 'chat-tab' })
  })

  it('declines when the host no longer names the pane at click time', async () => {
    mocks.resolve.mockResolvedValueOnce(OWNER).mockResolvedValueOnce({ kind: 'none' })
    const { result } = renderOwnerReturn()
    await waitFor(() => expect(result.current.ownsLeaf(LEAF)).toBe(true))

    let returned = true
    await act(async () => {
      returned = await result.current.returnLeafToChat(LEAF)
    })

    expect(returned).toBe(false)
    expect(mocks.requestReturn).not.toHaveBeenCalled()
    expect(mocks.activate).not.toHaveBeenCalled()
    expect(result.current.ownsLeaf(LEAF)).toBe(false)
  })

  it('leaves ordinary agent terminals alone when no Chat tab could own them', async () => {
    mocks.state.unifiedTabsByWorktree = { 'wt-1': [] }
    const { result } = renderOwnerReturn()

    await act(async () => {})

    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(result.current.ownsLeaf(LEAF)).toBe(false)
    expect(await result.current.returnLeafToChat(LEAF)).toBe(false)
  })

  it('asks again while the handoff is still settling', async () => {
    vi.useFakeTimers()
    try {
      mocks.resolve.mockResolvedValueOnce({ kind: 'settling' }).mockResolvedValue(OWNER)
      const { result } = renderOwnerReturn()
      await act(async () => {})
      expect(result.current.ownsLeaf(LEAF)).toBe(false)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(mocks.resolve).toHaveBeenCalledTimes(2)
      expect(result.current.ownsLeaf(LEAF)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not ask the host while the pane cannot be seen', async () => {
    mocks.resolve.mockResolvedValue(OWNER)
    renderOwnerReturn(false)

    await act(async () => {})

    expect(mocks.resolve).not.toHaveBeenCalled()
  })
})
