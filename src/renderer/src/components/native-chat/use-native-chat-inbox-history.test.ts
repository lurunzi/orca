// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionHistoryResult } from '../../../../shared/agent-session-wire'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { useNativeChatInboxHistory } from './use-native-chat-inbox-history'

const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.read
}))

const LOCAL = { kind: 'local' } as const

function page(
  sequence: number,
  hasOlder = false
): Extract<AgentSessionHistoryResult, { ok: true }> {
  const cursor = { epoch: 'epoch', sequence }
  return {
    ok: true,
    page: {
      sessionId: 'session',
      epoch: 'epoch',
      direction: 'tail',
      items: [
        {
          itemId: `user-${sequence}`,
          sequence,
          revision: 1,
          observedAt: sequence,
          body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'Task' }] }
        }
      ],
      removedItemIds: [],
      submissions: [],
      window: { oldest: cursor, newest: cursor, nextCursor: cursor },
      hasOlder,
      hasNewer: false
    }
  }
}

beforeEach(() => mocks.read.mockReset())
afterEach(cleanup)

describe('inbox history', () => {
  it('pages through the execution host only when requested', async () => {
    const target = { kind: 'environment', environmentId: 'remote' } as const
    mocks.read.mockResolvedValueOnce(page(10, true)).mockResolvedValueOnce(page(1))
    const { result } = renderHook(() =>
      useNativeChatInboxHistory({ sessionId: 'session', target, hasOlder: true })
    )
    expect(mocks.read).not.toHaveBeenCalled()
    act(() => result.current.load())
    await waitFor(() => expect(result.current.state).toBe('complete'))
    expect(mocks.read).toHaveBeenNthCalledWith(
      2,
      target,
      'agentSession.history',
      expect.objectContaining({
        sessionId: 'session',
        direction: 'before',
        cursor: { epoch: 'epoch', sequence: 10 }
      })
    )
    expect(result.current.items.map((item) => item.itemId)).toEqual(['user-10', 'user-1'])
  })

  it('offers retry after a transport failure without calling history complete', async () => {
    mocks.read.mockRejectedValueOnce(new Error('disconnected')).mockResolvedValueOnce(page(1))
    const { result } = renderHook(() =>
      useNativeChatInboxHistory({ sessionId: 'session', target: LOCAL, hasOlder: true })
    )
    act(() => result.current.load())
    await waitFor(() => expect(result.current.state).toBe('failed'))
    act(() => result.current.load())
    await waitFor(() => expect(result.current.state).toBe('complete'))
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })

  it('keeps local history separate from a remote environment named local', async () => {
    let finish: (value: AgentSessionHistoryResult) => void = () => {}
    mocks.read.mockReturnValue(
      new Promise<AgentSessionHistoryResult>((resolve) => {
        finish = resolve
      })
    )
    const initialProps: { target: RuntimeClientTarget } = { target: LOCAL }
    const { result, rerender } = renderHook(
      ({ target }: { target: RuntimeClientTarget }) =>
        useNativeChatInboxHistory({ sessionId: 'session', target, hasOlder: true }),
      { initialProps }
    )
    act(() => result.current.load())
    rerender({ target: { kind: 'environment', environmentId: 'local' } })
    await act(async () => finish(page(1)))
    expect(result.current.items).toEqual([])
    expect(result.current.state).toBe('idle')
  })

  it('reports a partial history if the host returns a cursor that does not move', async () => {
    mocks.read.mockResolvedValue(page(10, true))
    const { result } = renderHook(() =>
      useNativeChatInboxHistory({ sessionId: 'session', target: LOCAL, hasOlder: true })
    )
    act(() => result.current.load())
    await waitFor(() => expect(result.current.state).toBe('partial'))
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })

  it('discards cached rows when a rewind replaces the journal', async () => {
    mocks.read.mockResolvedValue(page(1))
    const { result, rerender } = renderHook(
      ({ epoch }) =>
        useNativeChatInboxHistory({ sessionId: 'session', target: LOCAL, hasOlder: true, epoch }),
      { initialProps: { epoch: 'epoch' } }
    )
    act(() => result.current.load())
    await waitFor(() => expect(result.current.state).toBe('complete'))
    expect(result.current.items).toHaveLength(1)
    rerender({ epoch: 'rewound' })
    expect(result.current.items).toEqual([])
    expect(result.current.state).toBe('idle')
  })

  it('does not mix pages from before and after a rewind', async () => {
    const next = page(1)
    next.page.epoch = 'rewound'
    mocks.read.mockResolvedValueOnce(page(10, true)).mockResolvedValueOnce(next)
    const { result } = renderHook(() =>
      useNativeChatInboxHistory({
        sessionId: 'session',
        target: LOCAL,
        hasOlder: true,
        epoch: 'epoch'
      })
    )
    act(() => result.current.load())
    await waitFor(() => expect(result.current.state).toBe('failed'))
    expect(result.current.items).toEqual([])
  })
})
