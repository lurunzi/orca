// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { migrateNativeChatComposerStorage } from './native-chat-composer-storage'
import { createMemoryNativeChatComposerDraftStorage } from './native-chat-composer-draft-storage'

afterEach(() => localStorage.clear())

function legacy(part: 'draft' | 'attachments', scope: string, value: unknown): string {
  const key = `orca.native-chat.${part}.v1:${scope}`
  localStorage.setItem(key, JSON.stringify({ savedAt: 10, value }))
  return key
}

describe('migrating fork drafts into the current persistent store', () => {
  it('keeps text, skill chips and remote image ownership across panes', async () => {
    const storage = createMemoryNativeChatComposerDraftStorage()
    const document = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '尚未发送' }] }]
    }
    legacy('draft', 'local:pane', { text: '尚未发送\n$review', document })
    legacy('attachments', 'local:pane', [
      { id: 'image', path: '/remote/image.png', connectionId: 'ssh-a', previewUrl: 'blob:private' }
    ])
    legacy('draft', 'remote:pane', { text: 'remote draft' })
    await migrateNativeChatComposerStorage(storage)
    expect(storage.drafts.get('local:pane')).toEqual({
      text: '尚未发送\n$review',
      document,
      images: [{ id: 'image', path: '/remote/image.png', connectionId: 'ssh-a' }],
      savedAt: 10
    })
    expect(storage.drafts.get('remote:pane')?.text).toBe('remote draft')
    expect(localStorage.length).toBe(0)
    await storage.remove(['local:pane'])
    await migrateNativeChatComposerStorage(storage)
    expect(storage.drafts.has('local:pane')).toBe(false)
  })

  it.each(['newer draft', ''])(
    'keeps a current-store value %j over the legacy copy',
    async (text) => {
      const storage = createMemoryNativeChatComposerDraftStorage()
      legacy('draft', 'pane', { text: 'old draft' })
      await storage.write('pane', { text, images: [], savedAt: 20 })
      await migrateNativeChatComposerStorage(storage)
      expect(storage.drafts.get('pane')?.text).toBe(text)
      expect(localStorage.length).toBe(0)
    }
  )

  it('retains the source when writing fails and retries without duplicating it', async () => {
    const storage = createMemoryNativeChatComposerDraftStorage()
    const key = legacy('draft', 'pane', { text: 'keep me' })
    storage.refuseWrites = true
    await expect(migrateNativeChatComposerStorage(storage)).rejects.toThrow()
    expect(localStorage.getItem(key)).not.toBeNull()
    storage.refuseWrites = false
    await migrateNativeChatComposerStorage(storage)
    expect(storage.drafts.get('pane')?.text).toBe('keep me')
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('does not discard a concurrent legacy edit or unrelated settings', async () => {
    const storage = createMemoryNativeChatComposerDraftStorage()
    const key = legacy('draft', 'pane', { text: 'first' })
    localStorage.setItem('settings', 'keep')
    const update = storage.update
    storage.update = async (...args) => {
      await update(...args)
      legacy('draft', 'pane', { text: 'edited while migrating' })
    }
    await migrateNativeChatComposerStorage(storage)
    expect(localStorage.getItem(key)).toContain('edited while migrating')
    expect(localStorage.getItem('settings')).toBe('keep')
  })
})
