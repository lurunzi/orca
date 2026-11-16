// Fork: the Inbox's jump requests, by chat pane, for the transcript that pane shows; never persisted.

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { NativeChatJumpRequest } from './use-native-chat-jump-request'

const requestByPane = new Map<string, NativeChatJumpRequest>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setInboxJump(paneKey: string, request: NativeChatJumpRequest | null): void {
  if ((requestByPane.get(paneKey) ?? null) === request) {
    return
  }
  if (request) {
    requestByPane.set(paneKey, request)
  } else {
    requestByPane.delete(paneKey)
  }
  for (const listener of listeners) {
    listener()
  }
}

/** `paneKey` is the chat's status pane key; an unmounted Inbox takes its request with it. */
export function usePublishNativeChatInboxJump(
  paneKey: string,
  request: NativeChatJumpRequest | null
): void {
  useEffect(() => {
    setInboxJump(paneKey, request)
    return () => setInboxJump(paneKey, null)
  }, [paneKey, request])
}

export function useNativeChatInboxJump(paneKey: string): NativeChatJumpRequest | null {
  const read = useCallback(() => requestByPane.get(paneKey) ?? null, [paneKey])
  return useSyncExternalStore(subscribe, read, read)
}
