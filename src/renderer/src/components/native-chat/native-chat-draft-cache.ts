import type { JSONContent } from '@tiptap/react'
import { z } from 'zod'
import { setBoundedScopeCacheEntry } from './native-chat-composer-scope-cache'
import {
  clearNativeChatComposerStorageForTests,
  readNativeChatComposerStorage,
  writeNativeChatComposerStorage
} from './native-chat-composer-storage'

const documentSchema: z.ZodType<JSONContent> = z.lazy(() =>
  z.object({
    type: z.enum(['doc', 'paragraph', 'text', 'hardBreak', 'nativeChatSkill']),
    text: z.string().optional(),
    attrs: z.object({ token: z.string() }).optional(),
    content: z.array(documentSchema).optional()
  })
)
const draftSchema = z.object({
  text: z.string(),
  document: documentSchema.optional().catch(undefined)
})

const draftCache = new Map<string, { text: string; document?: JSONContent }>()

function readDraft(scopeKey: string): { text: string; document?: JSONContent } | undefined {
  const cached = draftCache.get(scopeKey)
  if (cached) {
    return cached
  }
  const stored = draftSchema.safeParse(readNativeChatComposerStorage('draft', scopeKey)).data
  if (stored?.text) {
    setBoundedScopeCacheEntry(draftCache, scopeKey, stored)
  }
  return stored
}

export function readNativeChatDraftCache(scopeKey: string): string {
  return readDraft(scopeKey)?.text ?? ''
}

export function writeNativeChatDraftCache(scopeKey: string, draft: string): void {
  // An empty draft carries no state worth retaining; drop the entry so a stale
  // scope key never resurrects cleared text.
  if (draft === '') {
    draftCache.delete(scopeKey)
    writeNativeChatComposerStorage('draft', scopeKey, undefined)
    return
  }
  // LRU-bounded so unsent drafts for permanently-removed panes can't accumulate.
  const previous = readDraft(scopeKey)
  const next = {
    text: draft,
    document: previous?.text === draft ? previous.document : undefined
  }
  setBoundedScopeCacheEntry(draftCache, scopeKey, next)
  writeNativeChatComposerStorage('draft', scopeKey, next)
}

export function clearNativeChatDraftCacheForTests(): void {
  draftCache.clear()
  clearNativeChatComposerStorageForTests('draft')
}

export function readNativeChatDraftDocument(
  scopeKey: string,
  text: string
): JSONContent | undefined {
  const cached = readDraft(scopeKey)
  return cached?.text === text ? cached.document : undefined
}

export function writeNativeChatDraftDocument(
  scopeKey: string,
  text: string,
  document: JSONContent
): void {
  if (!text) {
    draftCache.delete(scopeKey)
    writeNativeChatComposerStorage('draft', scopeKey, undefined)
    return
  }
  setBoundedScopeCacheEntry(draftCache, scopeKey, { text, document })
  writeNativeChatComposerStorage('draft', scopeKey, { text, document })
}
