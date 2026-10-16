import { z } from 'zod'
import {
  parseStoredNativeChatComposerDraft,
  type NativeChatComposerDraftStorage
} from './native-chat-composer-draft-storage'

const entrySchema = z.object({ savedAt: z.number(), value: z.unknown() })
const textSchema = z.object({ text: z.string(), document: z.unknown().optional() })
const PREFIXES = ['orca.native-chat.draft.v1:', 'orca.native-chat.attachments.v1:'] as const

function legacyStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Move the fork's saved drafts into the current store before its first hydration. */
export async function migrateNativeChatComposerStorage(
  destination: NativeChatComposerDraftStorage
): Promise<void> {
  const storage = legacyStorage()
  if (!storage) {
    return
  }
  const scopes = new Set<string>()
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    const prefix = PREFIXES.find((candidate) => key?.startsWith(candidate))
    if (key && prefix) {
      scopes.add(key.slice(prefix.length))
    }
  }
  for (const scope of scopes) {
    const keys = PREFIXES.map((prefix) => prefix + scope)
    const raw = keys.map((key) => storage.getItem(key))
    const entries = raw.map((value) => {
      try {
        return entrySchema.safeParse(JSON.parse(value ?? 'null')).data
      } catch {
        return undefined
      }
    })
    const text = textSchema.safeParse(entries[0]?.value).data
    const draft = parseStoredNativeChatComposerDraft({
      text: text?.text ?? '',
      document: text?.document,
      images: Array.isArray(entries[1]?.value) ? entries[1].value : [],
      savedAt: Math.max(entries[0]?.savedAt ?? 0, entries[1]?.savedAt ?? 0)
    })
    if (!draft || (!draft.text && draft.images.length === 0)) {
      continue
    }
    // An atomic update preserves a newer window's draft, including an empty tombstone.
    await destination.update(
      scope,
      (current) => parseStoredNativeChatComposerDraft(current) ?? draft
    )
    keys.forEach((key, index) => {
      // An older renderer may still be editing while migration commits.
      if (storage.getItem(key) === raw[index]) {
        storage.removeItem(key)
      }
    })
  }
}
