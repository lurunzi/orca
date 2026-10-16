// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatRailItem } from './native-chat-message-rail-items'
import { useNativeChatJumpRequest } from './use-native-chat-jump-request'

afterEach(cleanup)

describe('useNativeChatJumpRequest', () => {
  it('waits for an older message outline and selects it once', () => {
    const select = vi.fn()
    const request = { messageId: 'older-message', requestId: 1 }
    const initial: readonly NativeChatRailItem[] = []
    const { rerender } = renderHook(
      ({ items }) => useNativeChatJumpRequest(request, items, select),
      { initialProps: { items: initial } }
    )
    expect(select).not.toHaveBeenCalled()

    const older = { id: 'older-message', slotIndex: null, text: 'Earlier task', hasImages: false }
    rerender({ items: [older] })
    expect(select).toHaveBeenCalledExactlyOnceWith(older)

    rerender({ items: [{ ...older, slotIndex: 0 }] })
    expect(select).toHaveBeenCalledTimes(1)
  })
})
