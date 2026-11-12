// @vitest-environment happy-dom
import { useState } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { createTerminalLayoutActions } from '@/store/terminals/terminal-layout-state'
import type { AppState } from '@/store/types'
import { useTerminalPaneLayoutBindings } from './layout/ownership/use-terminal-pane-layout-bindings'
import { useTerminalPaneProjection } from './controller/use-terminal-pane-projection'
import type { TerminalPaneMobileController } from './controller/use-terminal-pane-mobile-actions'

vi.mock('@/store', async () => {
  const { create } = await import('zustand')
  return {
    useAppStore: create<AppState>(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only layout actions and the chat projection read this store.
      () => ({ terminalLayoutsByTabId: {}, tabsByWorktree: {} }) as AppState
    )
  }
})

const CHAT = '11111111-1111-4111-8111-111111111111'
const SIBLING = '22222222-2222-4222-8222-222222222222'
const initialState = useAppStore.getState()

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
})

function renderChat(ptyId = 'pty-chat') {
  const panes = [CHAT, SIBLING].map((leafId, index) => ({ id: index + 1, leafId }))
  const boundIds = new Map<number, string | null>([
    [1, null],
    [2, 'pty-sibling']
  ])
  const transports = new Map([
    [1, { getPtyId: () => boundIds.get(1) ?? null }],
    [2, { getPtyId: () => boundIds.get(2) ?? null }]
  ])
  useAppStore.setState({
    ...createTerminalLayoutActions(useAppStore.setState, useAppStore.getState),
    terminalLayoutsByTabId: {
      tab: {
        root: {
          type: 'split',
          direction: 'horizontal',
          first: { type: 'leaf', leafId: CHAT },
          second: { type: 'leaf', leafId: SIBLING }
        },
        activeLeafId: CHAT,
        expandedLeafId: null,
        ptyIdsByLeafId: { [CHAT]: ptyId, [SIBLING]: 'pty-sibling' }
      }
    },
    tabsByWorktree: {
      wt: [
        {
          id: 'tab',
          worktreeId: 'wt',
          title: 'Antigravity',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 0,
          ptyId
        }
      ]
    }
  })
  const controller = {
    tabId: 'tab',
    worktreeId: 'wt',
    chatLeafId: CHAT,
    isChatViewMode: true,
    effectiveChatViewMode: true,
    isActive: true,
    isVisible: true,
    settings: null,
    systemPrefersDark: false,
    shouldMeasureHiddenStartup: false,
    managerRef: {
      current: {
        getActivePane: () => panes[0],
        getPanes: () => panes,
        getLeafId: (id: number) => panes.find((pane) => pane.id === id)?.leafId
      }
    },
    paneTransportsRef: { current: transports },
    paneTitles: {},
    terminalError: null,
    terminalErrorsByPaneId: {},
    terminalTab: null,
    contextMenu: { open: false, menuPaneId: null },
    contextMenuLeafId: null,
    tabAgentTypeByLeaf: { [CHAT]: 'antigravity' },
    applyNativeChatLeafRoute: vi.fn(),
    canToggleChatForLeaf: () => true,
    isChatEligibleForLeaf: () => true,
    getNativeChatLeafIds: () => [CHAT, SIBLING],
    getTabWideAgentHintLeafId: () => CHAT,
    resolveTitleAgentForLeaf: () => 'antigravity',
    setTerminalError: vi.fn(),
    setTerminalErrorsByPaneId: vi.fn(),
    setTabLayout: useAppStore.getState().setTabLayout,
    containerRef: { current: null },
    expandedPaneIdRef: { current: null },
    expandedStyleSnapshotRef: { current: new Map() },
    pendingPaneSizeRefreshFrameIdsRef: { current: [] },
    persistLayoutSnapshot: vi.fn(),
    setExpandedPaneId: vi.fn(),
    setTabPaneExpanded: vi.fn()
  }
  const hook = renderHook(() => {
    const [, setPaneLayoutRevision] = useState(0)
    // The real chat controller subscribes to the saved layout before projecting the live transport.
    useAppStore((state) => state.terminalLayoutsByTabId.tab)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture supplies every field these hooks read.
    const mounted = {
      ...controller,
      setPaneLayoutRevision
    } as unknown as TerminalPaneMobileController
    const bindings = useTerminalPaneLayoutBindings(mounted)
    return { bindings, projection: useTerminalPaneProjection(mounted) }
  })
  return { hook, boundIds }
}

describe('native chat after a delayed PTY attach', () => {
  it.each([
    ['pane', 'pty-chat'],
    ['leaf', 'pty-chat'],
    ['pane', 'remote:host:pty-chat'],
    ['leaf', 'remote:host:pty-chat']
  ])(
    'restores the composer route on %s bind for %s when its layout is already published',
    (route, ptyId) => {
      const { hook, boundIds } = renderChat(ptyId)
      const published = useAppStore.getState().terminalLayoutsByTabId.tab
      expect(hook.result.current.projection.chatPanePtyId).toBeNull()

      act(() => {
        boundIds.set(1, ptyId)
        if (route === 'leaf') {
          hook.result.current.bindings.syncPanePtyLayoutBindingForLeaf(CHAT, ptyId, 1)
        } else {
          hook.result.current.bindings.syncPanePtyLayoutBinding(1, ptyId)
        }
      })

      expect(useAppStore.getState().terminalLayoutsByTabId.tab).toBe(published)
      expect(hook.result.current.projection.chatPanePtyId).toBe(ptyId)
      expect(hook.result.current.projection.chatPane?.leafId).toBe(CHAT)
    }
  )

  it('keeps a disconnected chat disabled when only its sibling binds', () => {
    const { hook, boundIds } = renderChat()
    act(() => {
      boundIds.set(2, 'pty-sibling')
      hook.result.current.bindings.syncPanePtyLayoutBindingForLeaf(SIBLING, 'pty-sibling', 2)
    })
    expect(hook.result.current.projection.chatPanePtyId).toBeNull()
  })

  it('does not restore a stale PTY over a newer published binding', () => {
    const { hook, boundIds } = renderChat()
    act(() => {
      boundIds.set(1, 'pty-chat')
      hook.result.current.bindings.syncPanePtyLayoutBindingForLeaf(CHAT, 'pty-stale', 1)
    })
    expect(useAppStore.getState().terminalLayoutsByTabId.tab?.ptyIdsByLeafId?.[CHAT]).toBe(
      'pty-chat'
    )
    expect(hook.result.current.projection.chatPanePtyId).toBeNull()
  })
})
