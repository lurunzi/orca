// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatModelDiscoveryContext } from './native-chat-session-option-discovery'
import { useNativeChatModelUsage } from './use-native-chat-model-usage'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  watch: vi.fn(),
  local: { provider: 'antigravity' }
}))
vi.mock('@/store', () => ({
  useAppStore: (select: (state: unknown) => unknown) =>
    select({ rateLimits: { antigravity: mocks.local } })
}))
vi.mock('./native-chat-session-option-discovery', () => ({
  resolveNativeChatModelDiscoveryContext: mocks.resolve
}))
vi.mock('@/runtime/runtime-provider-accounts-client', () => ({
  watchProviderAccounts: mocks.watch
}))

const context = (hostKey: string): NativeChatModelDiscoveryContext => ({
  hostKey,
  runtime: { settings: null, worktreeId: null, worktreePath: '' }
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
describe('Chat quota host ownership', () => {
  it.each(['ssh:server', 'wsl:Ubuntu', 'unknown'])('does not show local quota for %s', (host) => {
    mocks.resolve.mockReturnValue(context(host))
    expect(
      renderHook(() => useNativeChatModelUsage('antigravity', 'tab')).result.current
    ).toBeNull()
  })
  it('uses local quota for a local chat and hides it for unrelated agents', () => {
    mocks.resolve.mockReturnValue(context('local'))
    expect(renderHook(() => useNativeChatModelUsage('antigravity', 'tab')).result.current).toBe(
      mocks.local
    )
    expect(renderHook(() => useNativeChatModelUsage('claude', 'tab')).result.current).toBeNull()
  })
  it('subscribes to the owning runtime, clears on a host change, and disposes', () => {
    const close = vi.fn()
    mocks.watch.mockReturnValue({ close })
    mocks.resolve.mockReturnValue(context('runtime:remote-one'))
    const { result, rerender, unmount } = renderHook(() =>
      useNativeChatModelUsage('antigravity', 'tab')
    )
    const handler = mocks.watch.mock.calls[0]?.[1]
    const snapshot = { rateLimits: { antigravity: mocks.local } }
    act(() => handler.onSnapshot(snapshot))
    expect(result.current).toBe(mocks.local)
    mocks.resolve.mockReturnValue(context('runtime:remote-two'))
    rerender()
    expect(result.current).toBeNull()
    expect(close).toHaveBeenCalledTimes(1)
    unmount()
    expect(close).toHaveBeenCalledTimes(2)
  })
})
