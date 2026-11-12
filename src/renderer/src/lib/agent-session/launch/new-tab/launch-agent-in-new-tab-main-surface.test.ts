import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../../../shared/constants'
import { createTestStore, seedStore } from '../../../../store/testing/app-store-test-fixture'
import { makeWorktree } from '../../../../store/slices/worktrees/worktree.test-fixture'
import { createStoreCascadesMockApi } from '../../../../store/testing/app-store-cascade-api.test-fixture'

vi.mock('@/runtime/rpc/calls/runtime-rpc-call', async (importOriginal) =>
  (
    await import('@/runtime/workspace-layout/testing/layout-apply-test-transport.test-fixture')
  ).runtimeRpcClientWithLayoutApply(await importOriginal())
)

const storeBox = vi.hoisted(() => {
  const box: { store: unknown } = { store: null }
  return box
})

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() }
}))

vi.mock('@/store/index', () => ({
  get useAppStore() {
    return storeBox.store
  }
}))

vi.mock('@/lib/agent-session/launch/inventory/host-chat-program-acquisition', async (original) => ({
  ...(await original<object>()),
  acquireAgentLaunchChoices: async () => ({ detected: ['claude', 'codex'] })
}))

vi.mock('@/components/terminal-pane/input/focus/focus-terminal-tab-surface', () => ({
  focusTerminalTabSurface: vi.fn()
}))

vi.mock('@/lib/agent-session/launch/prompt/launch-agent-tab-prompt-paste', () => ({
  pasteAgentLaunchPromptOnceReady: async () => ({ delivered: true, failureNotified: false })
}))

createStoreCascadesMockApi()

import { setLocalRuntimeCapabilitiesForTests } from '@/runtime/hosts/capabilities/local-runtime-capabilities'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setLocalRuntimeCapabilitiesForTests([])
})

const MAIN_WORKTREE_ID = 'repo1::/path/wt1'

function seedMainWindowOnEditor(): ReturnType<typeof createTestStore> {
  const store = createTestStore()
  storeBox.store = store
  seedStore(store, {
    settings: getDefaultSettings('/tmp'),
    worktreesByRepo: {
      repo1: [makeWorktree({ id: MAIN_WORKTREE_ID, repoId: 'repo1', path: '/path/wt1' })]
    },
    activeWorktreeId: MAIN_WORKTREE_ID
  })
  const mainTerminal = store.getState().createTab(MAIN_WORKTREE_ID)
  store.getState().setActiveTabType('editor', MAIN_WORKTREE_ID)
  expect(store.getState().activeTabId).toBe(mainTerminal.id)
  return store
}

describe('launchAgentInNewTab main-window surface', () => {
  it('opens Antigravity in transcript chat while retaining its terminal startup', async () => {
    const store = seedMainWindowOnEditor()
    store.setState({ settings: { ...getDefaultSettings('/tmp'), agentDefaultSurface: 'chat' } })
    const { launchAgentInNewTabWithOutcome } = await import('./launch-agent-in-new-tab')
    const result = launchAgentInNewTabWithOutcome({
      requestId: 'antigravity-chat',
      agent: 'antigravity',
      worktreeId: MAIN_WORKTREE_ID
    })
    if (result && 'refused' in result) {
      throw new Error('Expected an opened launch')
    }
    await result?.structuredSettlement
    const tabId = store
      .getState()
      .tabsByWorktree[MAIN_WORKTREE_ID]?.find((tab) => tab.launchAgent === 'antigravity')?.id
    expect(tabId).toBeDefined()
    if (!tabId) {
      throw new Error('Antigravity terminal was not created')
    }
    expect(store.getState().unifiedTabsByWorktree[MAIN_WORKTREE_ID]).toContainEqual(
      expect.objectContaining({ entityId: tabId, viewMode: 'chat' })
    )
    expect(store.getState().tabsByWorktree[MAIN_WORKTREE_ID]).toContainEqual(
      expect.objectContaining({
        id: tabId,
        launchAgent: 'antigravity'
      })
    )
    expect(store.getState().pendingStartupByTabId[tabId]).toMatchObject({
      launchAgent: 'antigravity'
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })
})
