import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSessionTitlesResult } from '../../../shared/ai-vault-session-title'
import type { Tab } from '../../../shared/tab-types'
import { resolveUnifiedTabLabel } from '../../../shared/tab-title-resolution'
import { structuredAgentSessionPaneKey } from '../../../shared/structured-agent-session-projection'
import { createTestStore, makeUnifiedTab } from '../store/slices/store-test-helpers'
import { collectAiVaultTitleRequests } from './ai-vault-tab-title-requests'
import { aiVaultTitleSyncInputsChanged } from './ai-vault-tab-title-sync-inputs'
import { startAiVaultTabTitleSync } from './ai-vault-tab-title-sync'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

const WORKSPACE = 'folder-chat'
const TAB_ID = 'chat-tab'
const PANE = structuredAgentSessionPaneKey(TAB_ID, 'session-1')
const stops: (() => void)[] = []

afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  vi.useRealTimers()
})

function fixture(
  agent: 'claude' | 'codex' = 'claude',
  executionHostId: Tab['executionHostId'] = 'local'
) {
  const store = createTestStore()
  store.setState({
    unifiedTabsByWorktree: {
      [WORKSPACE]: [
        makeUnifiedTab({
          id: TAB_ID,
          entityId: 'session-1',
          groupId: 'group-1',
          worktreeId: WORKSPACE,
          contentType: 'agent-session',
          agentSessionAgent: agent,
          executionHostId,
          label: `${agent} Chat`
        })
      ]
    },
    agentStatusByPaneKey: {
      [PANE]: {
        paneKey: PANE,
        tabId: TAB_ID,
        worktreeId: WORKSPACE,
        agentType: agent,
        providerSession: { key: 'session_id', id: 'provider-1' },
        state: 'done',
        prompt: 'Fix the title',
        updatedAt: 1,
        stateStartedAt: 1,
        stateHistory: []
      }
    }
  })
  const tab = () => store.getState().unifiedTabsByWorktree[WORKSPACE][0]
  const patchTab = (patch: Partial<Tab>) =>
    store.setState({
      unifiedTabsByWorktree: { [WORKSPACE]: [{ ...tab(), ...patch }] }
    })
  return { store, tab, patchTab }
}

describe('structured chat conversation titles', () => {
  it.each(['claude', 'codex'] as const)(
    'syncs %s history titles into a folder chat and follows renames',
    async (agent) => {
      vi.useFakeTimers()
      const { store, tab } = fixture(agent, 'runtime:server-1')
      const resolveSessionTitles = vi.fn().mockResolvedValue({
        titles: [{ agent, sessionId: 'provider-1', title: 'Fix tab titles' }]
      })
      stops.push(startAiVaultTabTitleSync({ ...store, resolveSessionTitles }))
      await vi.advanceTimersByTimeAsync(0)
      expect(resolveSessionTitles).toHaveBeenCalledWith({
        executionHostScope: 'runtime:server-1',
        requests: [{ agent, sessionId: 'provider-1' }]
      })
      expect(resolveUnifiedTabLabel(tab(), false)).toBe('Fix tab titles')
      resolveSessionTitles.mockResolvedValue({
        titles: [{ agent, sessionId: 'provider-1', title: 'Updated conversation' }]
      })
      await vi.advanceTimersByTimeAsync(20_000)
      expect(resolveSessionTitles).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(280_000)
      expect(resolveUnifiedTabLabel(tab(), false)).toBe('Updated conversation')
    }
  )

  it('keeps a manual name and reveals the synced title when it is cleared', () => {
    const { store, tab, patchTab } = fixture()
    patchTab({ customLabel: 'My name' })
    store.getState().setAiVaultTabTitle(TAB_ID, {
      agent: 'claude',
      sessionId: 'provider-1',
      title: 'History name'
    })
    expect(tab().aiVaultTitle?.title).toBe('History name')
    expect(resolveUnifiedTabLabel(tab(), false)).toBe('My name')
    store.getState().setTabCustomTitle(TAB_ID, null)
    expect(resolveUnifiedTabLabel(tab(), false)).toBe('History name')
    const before = store.getState()
    store.getState().setAiVaultTabTitle(TAB_ID, tab().aiVaultTitle ?? null)
    expect(store.getState()).toBe(before)
  })

  it('waits for provider identity and ignores a status from another agent', () => {
    const { store, patchTab } = fixture()
    patchTab({ agentSessionAgent: 'codex' })
    expect(collectAiVaultTitleRequests(store.getState())).toEqual([])
    store.setState({ agentStatusByPaneKey: {} })
    patchTab({ agentSessionAgent: 'claude' })
    expect(collectAiVaultTitleRequests(store.getState())).toEqual([])
  })

  it('ignores the old status when a new structured session reuses the tab', () => {
    const { store, patchTab } = fixture()
    patchTab({ entityId: 'replacement-session' })
    expect(collectAiVaultTitleRequests(store.getState())).toEqual([])
  })

  it('retains a known title while the owning host status is unavailable', async () => {
    vi.useFakeTimers()
    const { store, tab } = fixture('codex', 'runtime:server-1')
    store.getState().setAiVaultTabTitle(TAB_ID, {
      agent: 'codex',
      sessionId: 'provider-1',
      title: 'Known conversation'
    })
    store.setState({ agentStatusByPaneKey: {} })
    const resolveSessionTitles = vi.fn().mockResolvedValue({ titles: [] })
    stops.push(startAiVaultTabTitleSync({ ...store, resolveSessionTitles }))
    await vi.advanceTimersByTimeAsync(300_000)
    expect(resolveSessionTitles).not.toHaveBeenCalled()
    expect(resolveUnifiedTabLabel(tab(), false)).toBe('Known conversation')
  })

  it('keeps the placeholder until a title appears and stops looking up a closed chat', async () => {
    vi.useFakeTimers()
    const { store, tab } = fixture()
    const resolveSessionTitles = vi.fn().mockResolvedValue({ titles: [] })
    stops.push(startAiVaultTabTitleSync({ ...store, resolveSessionTitles }))
    await vi.advanceTimersByTimeAsync(0)
    expect(resolveUnifiedTabLabel(tab(), false)).toBe('claude Chat')
    resolveSessionTitles.mockResolvedValue({
      titles: [{ agent: 'claude', sessionId: 'provider-1', title: 'First message title' }]
    })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(resolveUnifiedTabLabel(tab(), false)).toBe('First message title')
    store.setState({ unifiedTabsByWorktree: {} })
    await vi.advanceTimersByTimeAsync(300_000)
    expect(resolveSessionTitles).toHaveBeenCalledTimes(2)
    expect(store.getState().unifiedTabsByWorktree).toEqual({})
  })

  it('does not let an old lookup overwrite a replacement conversation', async () => {
    vi.useFakeTimers()
    const { store, tab } = fixture()
    let finish: (result: AiVaultSessionTitlesResult) => void = () => {}
    const pending = new Promise<AiVaultSessionTitlesResult>((resolve) => {
      finish = resolve
    })
    const resolveSessionTitles = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockResolvedValue({ titles: [] })
    stops.push(startAiVaultTabTitleSync({ ...store, resolveSessionTitles }))
    await vi.advanceTimersByTimeAsync(0)
    expect(resolveSessionTitles).toHaveBeenCalledTimes(1)
    const entry = store.getState().agentStatusByPaneKey[PANE]
    store.setState({
      agentStatusByPaneKey: {
        [PANE]: { ...entry, providerSession: { key: 'session_id', id: 'provider-2' } }
      }
    })
    finish({ titles: [{ agent: 'claude', sessionId: 'provider-1', title: 'Old conversation' }] })
    await vi.advanceTimersByTimeAsync(0)
    expect(tab().aiVaultTitle).toBeUndefined()
    expect(resolveSessionTitles).toHaveBeenCalledTimes(2)
  })

  it('notices chat host/title/add/remove changes but ignores manual labels', () => {
    const { store, patchTab } = fixture()
    const original = store.getState()
    patchTab({ executionHostId: 'runtime:server-2' })
    expect(aiVaultTitleSyncInputsChanged(store.getState(), original)).toBe(true)
    expect(collectAiVaultTitleRequests(store.getState())[0]?.executionHostId).toBe(
      'runtime:server-2'
    )
    const moved = store.getState()
    patchTab({ customLabel: 'Manual' })
    expect(aiVaultTitleSyncInputsChanged(store.getState(), moved)).toBe(false)
    const renamed = store.getState()
    patchTab({ aiVaultTitle: { agent: 'claude', sessionId: 'provider-1', title: 'Stored' } })
    expect(aiVaultTitleSyncInputsChanged(store.getState(), renamed)).toBe(true)
    const named = store.getState()
    store.setState({ unifiedTabsByWorktree: {} })
    expect(aiVaultTitleSyncInputsChanged(store.getState(), named)).toBe(true)
    expect(aiVaultTitleSyncInputsChanged(named, store.getState())).toBe(true)
    expect(collectAiVaultTitleRequests(store.getState())).toEqual([])
  })
})
