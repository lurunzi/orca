// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryNativeChatComposerDraftStorage,
  setNativeChatComposerDraftStorageForTests
} from './native-chat-composer-draft-storage'
import {
  hydrateNativeChatComposerDrafts,
  nativeChatComposerDraftWritesSettled
} from './native-chat-composer-draft-store'
import {
  clearNativeChatAttachmentCacheForTests,
  useNativeChatComposerAttachments
} from './use-native-chat-composer-attachments'
import type { NativeChatComposerInput } from './native-chat-composer-input'

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/runtime/runtime-terminal-inspection', () => ({ isRemoteRuntimePtyId: () => false }))

let storage: ReturnType<typeof createMemoryNativeChatComposerDraftStorage>
beforeEach(async () => {
  storage = createMemoryNativeChatComposerDraftStorage()
  setNativeChatComposerDraftStorageForTests(storage)
  await hydrateNativeChatComposerDrafts()
})

async function restartCache(): Promise<void> {
  await nativeChatComposerDraftWritesSettled()
  clearNativeChatAttachmentCacheForTests()
  setNativeChatComposerDraftStorageForTests(storage)
  await hydrateNativeChatComposerDrafts()
}

afterEach(() => {
  cleanup()
  clearNativeChatAttachmentCacheForTests()
})

function mount(scopeKey: string) {
  return renderHook(() =>
    useNativeChatComposerAttachments({
      attachmentScopeKey: scopeKey,
      allowWithoutTarget: true,
      caret: 0,
      disabled: false,
      isComposing: () => false,
      resolveTarget: () => null,
      textareaRef: createRef<NativeChatComposerInput>(),
      setCaret: vi.fn(),
      setDraft: vi.fn(),
      setNotice: vi.fn()
    })
  )
}

describe('durable native chat image attachments', () => {
  it('restores saved paths and host ownership without persisting transient previews', async () => {
    const first = mount('tab-a:pane-a')
    let id: string | null = null
    act(() => {
      id = first.result.current.beginPendingImageAttachment('blob:private-image')
    })
    expect(id).not.toBeNull()
    act(() => {
      if (id) {
        first.result.current.resolvePendingImageAttachment(id, '/tmp/image.png', 'ssh-a')
      }
    })
    first.unmount()
    await restartCache()
    const restored = mount('tab-a:pane-a')
    expect(restored.result.current.imageAttachments).toEqual([
      { id, path: '/tmp/image.png', connectionId: 'ssh-a' }
    ])
    expect(mount('tab-b:pane-b').result.current.imageAttachments).toEqual([])
    expect(JSON.stringify(localStorage)).not.toContain('blob:private-image')
    act(() => restored.result.current.clearImageAttachments())
    restored.unmount()
    await restartCache()
    expect(mount('tab-a:pane-a').result.current.imageAttachments).toEqual([])
  })

  it('does not restore an upload that never finished', async () => {
    const first = mount('pending-pane')
    act(() => {
      first.result.current.beginPendingImageAttachment('blob:pending')
    })
    first.unmount()
    await restartCache()
    expect(mount('pending-pane').result.current.imageAttachments).toEqual([])
  })
})
