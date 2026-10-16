// What the user did to inbox entries on this device: dismissed, answered, or sent to the agent.
// Kept per session and host, beside the journal rather than in it: the agent's own record stays
// the journal, and a mark only hides or annotates an entry until the agent's next word on it.

import { useCallback, useSyncExternalStore } from 'react'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'

export type NativeChatInboxMark = 'dismissed' | 'answered' | 'sent'

const MARKS: readonly NativeChatInboxMark[] = ['dismissed', 'answered', 'sent']
const PREFIX = 'orca:nativeChatInbox:v1:'
const MAX_SESSIONS = 100
const MAX_MARKS_PER_SESSION = 200
const NO_MARKS: ReadonlyMap<string, NativeChatInboxMark> = new Map()

const cache = new Map<string, ReadonlyMap<string, NativeChatInboxMark>>()
const listeners = new Map<string, Set<() => void>>()

/** One session on one host: the same session id on two hosts is two inboxes. */
export function nativeChatInboxScopeKey(
  target: RuntimeClientTarget,
  sessionId: string,
  epoch?: string | null
): string {
  const host = target.kind === 'local' ? 'local' : `environment:${target.environmentId}`
  const key = `${host}:${sessionId}`
  return epoch ? JSON.stringify([key, epoch]) : key
}

function storageKey(scopeKey: string): string {
  return `${PREFIX}${encodeURIComponent(scopeKey)}`
}

function isMark(value: unknown): value is NativeChatInboxMark {
  return MARKS.some((mark) => mark === value)
}

function readStored(scopeKey: string): ReadonlyMap<string, NativeChatInboxMark> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(scopeKey)) ?? 'null')
    if (!value || typeof value !== 'object' || !('marks' in value)) {
      return NO_MARKS
    }
    const marks = value.marks
    if (!marks || typeof marks !== 'object') {
      return NO_MARKS
    }
    return new Map(
      Object.entries(marks).flatMap(([key, mark]): [string, NativeChatInboxMark][] =>
        isMark(mark) ? [[key, mark]] : []
      )
    )
  } catch {
    return NO_MARKS
  }
}

export function readNativeChatInboxMarks(
  scopeKey: string
): ReadonlyMap<string, NativeChatInboxMark> {
  let marks = cache.get(scopeKey)
  if (!marks) {
    marks = readStored(scopeKey)
    cache.set(scopeKey, marks)
  }
  return marks
}

function touchedAt(key: string): number {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    return value &&
      typeof value === 'object' &&
      'touchedAt' in value &&
      typeof value.touchedAt === 'number'
      ? value.touchedAt
      : 0
  } catch {
    return 0
  }
}

/** Past the cap, the sessions marked longest ago lose their marks. */
function evictOldSessions(): void {
  const keys: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(PREFIX)) {
      keys.push(key)
    }
  }
  if (keys.length <= MAX_SESSIONS) {
    return
  }
  const oldest = keys
    .map((key) => ({ key, at: touchedAt(key) }))
    .sort((a, b) => a.at - b.at)
    .slice(0, keys.length - MAX_SESSIONS)
  for (const { key } of oldest) {
    localStorage.removeItem(key)
  }
}

/** Sets or clears one entry's mark; null clears it. */
export function setNativeChatInboxMark(
  scopeKey: string,
  entryKey: string,
  mark: NativeChatInboxMark | null
): void {
  const next = new Map(readNativeChatInboxMarks(scopeKey))
  // Re-inserted, so the cap drops the marks set longest ago.
  next.delete(entryKey)
  if (mark !== null) {
    next.set(entryKey, mark)
  }
  const bounded: ReadonlyMap<string, NativeChatInboxMark> = new Map(
    [...next].slice(-MAX_MARKS_PER_SESSION)
  )
  cache.set(scopeKey, bounded)
  try {
    const key = storageKey(scopeKey)
    const isNewSession = localStorage.getItem(key) === null
    localStorage.setItem(
      key,
      JSON.stringify({ touchedAt: Date.now(), marks: Object.fromEntries(bounded) })
    )
    if (isNewSession) {
      evictOldSessions()
    }
  } catch {
    // Storage full or unavailable: the mark still holds until the app restarts.
  }
  for (const listener of listeners.get(scopeKey) ?? []) {
    listener()
  }
}

export function useNativeChatInboxMarks(
  scopeKey: string
): ReadonlyMap<string, NativeChatInboxMark> {
  const subscribe = useCallback(
    (listener: () => void) => {
      let set = listeners.get(scopeKey)
      if (!set) {
        set = new Set()
        listeners.set(scopeKey, set)
      }
      const owned = set
      owned.add(listener)
      return () => {
        owned.delete(listener)
        if (owned.size === 0 && listeners.get(scopeKey) === owned) {
          listeners.delete(scopeKey)
        }
      }
    },
    [scopeKey]
  )
  const snapshot = useCallback(() => readNativeChatInboxMarks(scopeKey), [scopeKey])
  return useSyncExternalStore(subscribe, snapshot)
}

/** Test seam: forget what this process read, as a fresh launch would. */
export function resetNativeChatInboxMarksCache(): void {
  cache.clear()
}
