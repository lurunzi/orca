import { useEffect, useRef } from 'react'
import type { NativeChatRailItem } from './native-chat-message-rail-items'

/** A request, from outside the transcript, to bring one user message to the top. */
export type NativeChatJumpRequest = { messageId: string; requestId: number }

/**
 * Serves each jump request once, through the rail's own selection, so a message older than the
 * loaded window pages in exactly as a rail click would page it in.
 */
export function useNativeChatJumpRequest(
  request: NativeChatJumpRequest | null | undefined,
  items: readonly NativeChatRailItem[],
  select: (item: NativeChatRailItem) => void
): void {
  const serviced = useRef(0)
  useEffect(() => {
    if (!request || serviced.current === request.requestId) {
      return
    }
    const item = items.find((entry) => entry.id === request.messageId)
    if (item) {
      serviced.current = request.requestId
      select(item)
    }
  }, [items, request, select])
}
