// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('native chat drafts across renderer restarts', () => {
  it('restores multiline text and skill chips after the renderer restarts', async () => {
    const cache = await import('./native-chat-draft-cache')
    const text = '尚未发送\n$review 查看代码'
    const document = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '尚未发送' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'nativeChatSkill', attrs: { token: '$review' } },
            { type: 'text', text: ' 查看代码' }
          ]
        }
      ]
    }
    cache.writeNativeChatDraftCache('tab-a:pane-a', text)
    cache.writeNativeChatDraftDocument('tab-a:pane-a', text, document)
    vi.resetModules()
    const restarted = await import('./native-chat-draft-cache')
    expect(restarted.readNativeChatDraftCache('tab-a:pane-a')).toBe(text)
    expect(restarted.readNativeChatDraftDocument('tab-a:pane-a', text)).toEqual(document)
    expect(restarted.readNativeChatDraftCache('tab-b:pane-b')).toBe('')
  })

  it.each(['text', 'document'])('does not resurrect a draft cleared via %s', async (method) => {
    const cache = await import('./native-chat-draft-cache')
    cache.writeNativeChatDraftCache('pane', 'send me')
    if (method === 'text') {
      cache.writeNativeChatDraftCache('pane', '')
    } else {
      cache.writeNativeChatDraftDocument('pane', '', { type: 'doc', content: [] })
    }
    vi.resetModules()
    const restarted = await import('./native-chat-draft-cache')
    expect(restarted.readNativeChatDraftCache('pane')).toBe('')
    expect(localStorage.length).toBe(0)
  })

  it('keeps independently written pane drafts when different renderers save', async () => {
    const first = await import('./native-chat-draft-cache')
    vi.resetModules()
    const second = await import('./native-chat-draft-cache')
    first.writeNativeChatDraftCache('local-pane', 'local draft')
    second.writeNativeChatDraftCache('ssh-pane', 'remote draft')
    first.writeNativeChatDraftCache('local-pane', 'edited local draft')
    vi.resetModules()
    const restarted = await import('./native-chat-draft-cache')
    expect(restarted.readNativeChatDraftCache('local-pane')).toBe('edited local draft')
    expect(restarted.readNativeChatDraftCache('ssh-pane')).toBe('remote draft')
  })

  it('bounds durable drafts using the existing scope limit', async () => {
    const { NATIVE_CHAT_COMPOSER_SCOPE_CACHE_MAX: limit } =
      await import('./native-chat-composer-scope-cache')
    const cache = await import('./native-chat-draft-cache')
    for (let index = 0; index < limit + 3; index++) {
      vi.spyOn(Date, 'now').mockReturnValue(index)
      cache.writeNativeChatDraftCache(`pane-${index}`, `draft-${index}`)
    }
    expect(localStorage.length).toBe(limit)
    vi.resetModules()
    const restarted = await import('./native-chat-draft-cache')
    expect(restarted.readNativeChatDraftCache('pane-0')).toBe('')
    expect(restarted.readNativeChatDraftCache(`pane-${limit + 2}`)).toBe(`draft-${limit + 2}`)
  })

  it('keeps draft text when stored editor metadata is invalid', async () => {
    const cache = await import('./native-chat-draft-cache')
    cache.writeNativeChatDraftCache('pane', 'still readable')
    const key = localStorage.key(0)
    if (!key) {
      throw new Error('Draft was not stored')
    }
    localStorage.setItem(
      key,
      JSON.stringify({
        savedAt: 1,
        value: { text: 'still readable', document: { type: 'obsolete-node' } }
      })
    )
    vi.resetModules()
    const restarted = await import('./native-chat-draft-cache')
    expect(restarted.readNativeChatDraftCache('pane')).toBe('still readable')
    expect(restarted.readNativeChatDraftDocument('pane', 'still readable')).toBeUndefined()
  })

  it('ignores malformed stored data without breaking the composer', async () => {
    const cache = await import('./native-chat-draft-cache')
    cache.writeNativeChatDraftCache('pane', 'previous draft')
    const key = localStorage.key(0)
    if (!key) {
      throw new Error('Draft was not stored')
    }
    localStorage.setItem(key, '{broken')
    vi.resetModules()
    const restarted = await import('./native-chat-draft-cache')
    expect(restarted.readNativeChatDraftCache('pane')).toBe('')
    restarted.writeNativeChatDraftCache('pane', 'replacement')
    vi.resetModules()
    expect((await import('./native-chat-draft-cache')).readNativeChatDraftCache('pane')).toBe(
      'replacement'
    )
  })

  it('retains unsaved text in memory when storage fails and retries on the next edit', async () => {
    const cache = await import('./native-chat-draft-cache')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage full')
    })
    cache.writeNativeChatDraftCache('pane', 'keep in memory')
    expect(cache.readNativeChatDraftCache('pane')).toBe('keep in memory')
    expect(warning).toHaveBeenCalledOnce()
    write.mockRestore()
    cache.writeNativeChatDraftCache('pane', 'saved after retry')
    vi.resetModules()
    expect((await import('./native-chat-draft-cache')).readNativeChatDraftCache('pane')).toBe(
      'saved after retry'
    )
  })
})
