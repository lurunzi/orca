import { describe, expect, it, vi } from 'vitest'
import { createEditorTabsStore } from './editor-slice-test-harness'

vi.mock('@/runtime/close-mirrored-editor-tab', () => ({
  notifyHostOfMirroredEditorClose: vi.fn()
}))

function openMarkdown(store: ReturnType<typeof createEditorTabsStore>, worktreeId: string) {
  return store.getState().openFile({
    filePath: '/repo/notes.md',
    relativePath: 'notes.md',
    worktreeId,
    language: 'markdown',
    mode: 'edit'
  })
}

describe.each(['closeFile', 'closeAllFiles'] as const)('%s unified surface selection', (action) => {
  function closeEditors(store: ReturnType<typeof createEditorTabsStore>, fileId: string) {
    if (action === 'closeFile') {
      store.getState().closeFile(fileId)
    } else {
      store.getState().closeAllFiles()
    }
  }

  it.each(['wt-1', 'folder:notes', 'ssh:repo::/repo'])(
    'keeps the chat visible in workspace %s after closing Markdown',
    (worktreeId) => {
      const store = createEditorTabsStore()
      store.setState({ activeWorktreeId: worktreeId })
      const chat = store.getState().createUnifiedTab(worktreeId, 'agent-session', {
        entityId: 'session-1',
        label: 'Codex Chat',
        agentSessionAgent: 'codex'
      })
      const fileId = openMarkdown(store, worktreeId)
      expect(store.getState().activeTabType).toBe('editor')
      const selections: (string | null)[] = []
      const unsubscribe = store.subscribe((state) => selections.push(state.activeWorktreeId))

      closeEditors(store, fileId)
      unsubscribe()

      expect(store.getState().activeWorktreeId).toBe(worktreeId)
      expect(selections).not.toContain(null)
      expect(store.getState().activeTabType).toBe('agent-session')
      expect(store.getState().activeTabTypeByWorktree[worktreeId]).toBe('agent-session')
      expect(store.getState().groupsByWorktree[worktreeId][0].activeTabId).toBe(chat.id)
      expect(store.getState().unifiedTabsByWorktree[worktreeId]).toEqual([chat])
      expect(store.getState().openFiles).toEqual([])
      expect(store.getState().activeFileId).toBeNull()
    }
  )

  it.each(['simulator', 'browser', 'terminal'] as const)(
    'restores a remaining unified-only %s tab',
    (contentType) => {
      const store = createEditorTabsStore()
      const tab = store.getState().createUnifiedTab('wt-1', contentType)
      const fileId = openMarkdown(store, 'wt-1')

      closeEditors(store, fileId)

      expect(store.getState().activeWorktreeId).toBe('wt-1')
      expect(store.getState().activeTabType).toBe(contentType)
      expect(store.getState().groupsByWorktree['wt-1'][0].activeTabId).toBe(tab.id)
    }
  )

  it('returns to the landing page when no tabs remain, even if another workspace has a chat', () => {
    const store = createEditorTabsStore()
    const otherChat = store.getState().createUnifiedTab('wt-2', 'agent-session')
    const fileId = openMarkdown(store, 'wt-1')

    closeEditors(store, fileId)

    expect(store.getState().activeWorktreeId).toBeNull()
    expect(store.getState().unifiedTabsByWorktree['wt-1']).toEqual([])
    expect(store.getState().unifiedTabsByWorktree['wt-2']).toEqual([otherChat])
    expect(store.getState().activeFileId).toBeNull()
  })

  it('keeps the most recently selected chat when several chats remain', () => {
    const store = createEditorTabsStore()
    store.getState().createUnifiedTab('wt-1', 'agent-session', { entityId: 'session-1' })
    const recent = store.getState().createUnifiedTab('wt-1', 'agent-session', {
      entityId: 'session-2'
    })
    const fileId = openMarkdown(store, 'wt-1')

    closeEditors(store, fileId)

    expect(store.getState().activeWorktreeId).toBe('wt-1')
    expect(store.getState().groupsByWorktree['wt-1'][0].activeTabId).toBe(recent.id)
    expect(store.getState().activeTabType).toBe('agent-session')
  })

  it('returns to the chat in the other split when its editor group becomes empty', () => {
    const store = createEditorTabsStore()
    const chat = store.getState().createUnifiedTab('wt-1', 'agent-session')
    const editorGroupId = store.getState().createEmptySplitGroup('wt-1', chat.groupId, 'right')
    expect(editorGroupId).not.toBeNull()
    const fileId = openMarkdown(store, 'wt-1')

    closeEditors(store, fileId)

    expect(store.getState().activeWorktreeId).toBe('wt-1')
    expect(store.getState().activeGroupIdByWorktree['wt-1']).toBe(chat.groupId)
    expect(store.getState().groupsByWorktree['wt-1']).toHaveLength(1)
    expect(store.getState().activeTabType).toBe('agent-session')
  })
})

it('closes several Markdown files without losing the remaining chat', () => {
  const store = createEditorTabsStore()
  const chat = store.getState().createUnifiedTab('wt-1', 'agent-session')
  openMarkdown(store, 'wt-1')
  store.getState().openFile({
    filePath: '/repo/second.md',
    relativePath: 'second.md',
    worktreeId: 'wt-1',
    language: 'markdown',
    mode: 'edit'
  })

  store.getState().closeAllFiles()

  expect(store.getState().activeWorktreeId).toBe('wt-1')
  expect(store.getState().unifiedTabsByWorktree['wt-1']).toEqual([chat])
  expect(store.getState().openFiles).toEqual([])
  expect(store.getState().activeTabType).toBe('agent-session')
})

it('keeps the current chat selected when an inactive workspace editor closes', () => {
  const store = createEditorTabsStore()
  const fileId = openMarkdown(store, 'wt-1')
  store.setState({ activeWorktreeId: 'wt-2' })
  const chat = store.getState().createUnifiedTab('wt-2', 'agent-session')
  store.getState().focusGroup('wt-2', chat.groupId)
  expect(store.getState().activeTabType).toBe('agent-session')

  store.getState().closeFile(fileId)

  expect(store.getState().activeWorktreeId).toBe('wt-2')
  expect(store.getState().activeTabType).toBe('agent-session')
  expect(store.getState().groupsByWorktree['wt-2'][0].activeTabId).toBe(chat.id)
})
