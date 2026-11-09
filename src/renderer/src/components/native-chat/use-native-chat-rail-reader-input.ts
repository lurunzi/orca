import { useCallback } from 'react'
import { useNativeChatRailWake } from './viewport/rail/use-native-chat-rail-wake'
import {
  useNativeChatJumpRequest,
  type NativeChatJumpRequest
} from './use-native-chat-jump-request'
import type { NativeChatRailItem } from './viewport/rail/native-chat-message-rail-items'

/** Fork: the reader's scrolls light the idle rail, and outside jump requests select its items. */
export function useNativeChatRailReaderInput(
  transcriptScroll: {
    onScroll: (event: React.UIEvent<HTMLDivElement>) => void
    recordReaderScroll: () => void
  },
  rail: { items: readonly NativeChatRailItem[] },
  navigation: { beginNavigation: () => void; selectRailItem: (item: NativeChatRailItem) => void },
  jumpRequest: NativeChatJumpRequest | null | undefined
): {
  railRef: React.RefObject<HTMLDivElement | null>
  onTranscriptScroll: (event: React.UIEvent<HTMLDivElement>) => void
  onReaderScroll: () => void
} {
  const { onScroll, recordReaderScroll } = transcriptScroll
  const { beginNavigation, selectRailItem } = navigation
  const { railRef, wake: wakeRail, sustain: sustainRail } = useNativeChatRailWake()
  const onTranscriptScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      onScroll(event)
      sustainRail()
    },
    [onScroll, sustainRail]
  )
  useNativeChatJumpRequest(jumpRequest, rail.items, selectRailItem)
  const onReaderScroll = useCallback(() => {
    beginNavigation()
    recordReaderScroll()
    wakeRail()
  }, [beginNavigation, recordReaderScroll, wakeRail])
  return { railRef, onTranscriptScroll, onReaderScroll }
}
