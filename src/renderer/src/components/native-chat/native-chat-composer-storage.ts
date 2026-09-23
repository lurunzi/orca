import { z } from 'zod'
import { NATIVE_CHAT_COMPOSER_SCOPE_CACHE_MAX } from './native-chat-composer-scope-cache'

type ComposerPart = 'draft' | 'attachments'
const storedEntrySchema = z.object({ savedAt: z.number(), value: z.unknown() })
let warnedAboutStorageFailure = false

function storagePrefix(part: ComposerPart): string {
  return `orca.native-chat.${part}.v1:`
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function readNativeChatComposerStorage(part: ComposerPart, scopeKey: string): unknown {
  try {
    const raw = getStorage()?.getItem(storagePrefix(part) + scopeKey)
    return raw ? storedEntrySchema.safeParse(JSON.parse(raw)).data?.value : undefined
  } catch {
    return undefined
  }
}

function trimStoredScopes(storage: Storage, part: ComposerPart): void {
  const prefix = storagePrefix(part)
  const entries: { key: string; savedAt: number }[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(prefix)) {
      continue
    }
    let savedAt = 0
    try {
      const parsed = storedEntrySchema.safeParse(JSON.parse(storage.getItem(key) ?? 'null'))
      savedAt = parsed.data?.savedAt ?? 0
    } catch {
      // Corrupt entries are discarded before valid drafts when the cache fills.
    }
    entries.push({ key, savedAt })
  }
  entries.sort((a, b) => a.savedAt - b.savedAt)
  for (const entry of entries.slice(0, -NATIVE_CHAT_COMPOSER_SCOPE_CACHE_MAX)) {
    storage.removeItem(entry.key)
  }
}

export function writeNativeChatComposerStorage(
  part: ComposerPart,
  scopeKey: string,
  value: unknown
): void {
  const storage = getStorage()
  if (!storage) {
    return
  }
  const key = storagePrefix(part) + scopeKey
  try {
    if (value === undefined) {
      storage.removeItem(key)
      return
    }
    const isNewScope = storage.getItem(key) === null
    // Per-pane keys prevent another window's save from replacing unrelated drafts.
    storage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }))
    if (isNewScope) {
      trimStoredScopes(storage, part)
    }
    warnedAboutStorageFailure = false
  } catch {
    // Retain the in-memory draft if browser storage is full or disabled.
    if (!warnedAboutStorageFailure) {
      warnedAboutStorageFailure = true
      console.warn('Native chat draft could not be saved for restart')
    }
  }
}

export function clearNativeChatComposerStorageForTests(part: ComposerPart): void {
  const storage = getStorage()
  if (!storage) {
    return
  }
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index)
    if (key?.startsWith(storagePrefix(part))) {
      storage.removeItem(key)
    }
  }
  warnedAboutStorageFailure = false
}
