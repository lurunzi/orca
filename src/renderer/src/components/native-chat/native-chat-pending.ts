import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { setBoundedScopeCacheEntry } from '../../../../shared/native-chat/native-chat-scope-cache'
import {
  NATIVE_CHAT_PENDING_SEND_LIMIT,
  transcriptTimestampAtOrAfterLocal,
  type NativeChatPendingSend
} from '../../../../shared/native-chat-pending-sends'
import type { NativeChatLaunchPrompt } from '@/lib/native-chat-launch-prompt'
import { normalizedNativeChatUserMessageText } from '../../../../shared/native-chat/transcript/native-chat-image-transcript-markers'
import { matchesCursorLaunchPromptEcho } from './cursor-launch-prompt-echo'
import {
  advancedNativeChatUserContentCounts,
  assignNativeChatPendingOccurrence,
  matchingNativeChatUserContentCounts,
  nativeChatPendingContentKey
} from '../../../../shared/native-chat-pending-occurrence'

export type NativeChatPendingSendScope = {
  paneKey: string
  agent: string
}

const pendingSendCache = new Map<string, NativeChatPendingSend[]>()
let pendingSendCounter = 0

function pendingSendScopeKey(scope: NativeChatPendingSendScope): string {
  return `${scope.paneKey}\0${scope.agent}`
}

export function readPendingSendCache(scope: NativeChatPendingSendScope): NativeChatPendingSend[] {
  return [...(pendingSendCache.get(pendingSendScopeKey(scope)) ?? [])]
}

export function writePendingSendCache(
  scope: NativeChatPendingSendScope,
  pending: NativeChatPendingSend[]
): NativeChatPendingSend[] {
  const next = pending.slice(-NATIVE_CHAT_PENDING_SEND_LIMIT)
  const key = pendingSendScopeKey(scope)
  if (next.length === 0) {
    pendingSendCache.delete(key)
  } else {
    // Bound abandoned-send scope keys too; crash/early close can bypass normal empty-drain cleanup.
    setBoundedScopeCacheEntry(pendingSendCache, key, next)
  }
  return [...next]
}

export function appendPendingSendCache(
  scope: NativeChatPendingSendScope,
  entry: NativeChatPendingSend
): NativeChatPendingSend[] {
  const contentKey = nativeChatPendingContentKey(entry)
  // Why: a resend replaces its failed copy; kept, that copy would claim the resend's row and pin it.
  const existing = readPendingSendCache(scope).filter(
    (candidate) => !candidate.delivery || nativeChatPendingContentKey(candidate) !== contentKey
  )
  const next = assignNativeChatPendingOccurrence(existing, entry)
  return writePendingSendCache(scope, [...existing, next])
}

export function clearPendingSendCacheForTests(): void {
  pendingSendCache.clear()
  pendingSendCounter = 0
}

// Synthetic launch ids never match real turns; reconcile normalized user text instead.
export function launchPromptAsMessage(
  entry: NativeChatLaunchPrompt | null,
  existingMessages: NativeChatMessage[] = []
): NativeChatMessage | null {
  if (!entry) {
    return null
  }
  // A new session’s timestampless matching row can only represent its launch prompt.
  const represented = matchingNativeChatUserContentCounts(
    launchPromptMatchingMessages(entry, existingMessages)
  )
  if ((represented.get(nativeChatPendingContentKey(entry)) ?? 0) > 0) {
    return null
  }
  return {
    id: `launch-pending:${entry.tabId}`,
    role: 'user' as const,
    blocks: entry.text.trim().length > 0 ? [{ type: 'text' as const, text: entry.text }] : [],
    timestamp: entry.createdAt,
    source: 'scrape' as const
  }
}

// Wait for a later non-user turn to avoid a first-turn flash before the transcript catches up.
export function shouldPruneLaunchPrompt(
  entry: NativeChatLaunchPrompt,
  messages: NativeChatMessage[]
): boolean {
  const relevant = launchPromptMatchingMessages(entry, messages)
  return (
    (advancedNativeChatUserContentCounts(relevant).get(nativeChatPendingContentKey(entry)) ?? 0) > 0
  )
}

function launchPromptMatchingMessages(
  entry: NativeChatLaunchPrompt,
  messages: NativeChatMessage[]
): NativeChatMessage[] {
  const relevant = messages.filter(
    (message) =>
      message.timestamp === null ||
      transcriptTimestampAtOrAfterLocal(message.timestamp, entry.createdAt)
  )
  const firstUser = relevant.findIndex((message) => message.role === 'user')
  // Compare the original only for echo retirement; never rewrite the provider's visible record.
  return relevant.map((message, index) =>
    entry.agent === 'cursor' &&
    index === firstUser &&
    matchesCursorLaunchPromptEcho(entry.text, normalizedNativeChatUserMessageText(message) ?? '')
      ? { ...message, blocks: [{ type: 'text', text: entry.text }] }
      : message
  )
}

export function nextNativeChatPendingSendId(now = Date.now()): string {
  pendingSendCounter += 1
  return `${now}-${pendingSendCounter}`
}

export function isLaunchPromptMessageId(id: string): boolean {
  return id.startsWith('launch-pending:')
}
