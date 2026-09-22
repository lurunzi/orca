// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { AiVaultListResult, AiVaultSession } from '../../../../shared/ai-vault-types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { Tab } from '../../../../shared/tab-types'
import type * as TranscriptTabModule from '@/lib/cursor-transcript-tab'

const mocks = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn(() => true) }))
type State = {
  activeWorktreeId: string
  path: string
  host: ExecutionHostId
  workspaceSessionReady: boolean
  unifiedTabsByWorktree: Record<string, Tab[]>
  agentStatusByPaneKey: Record<string, { providerSession?: { id: string } }>
}
const store = create<State>(() => ({
  activeWorktreeId: 'worker',
  path: '/work/worker',
  host: 'local',
  workspaceSessionReady: true,
  unifiedTabsByWorktree: {},
  agentStatusByPaneKey: {}
}))
vi.mock('@/store', () => ({ useAppStore: (...args: Parameters<typeof store>) => store(...args) }))
// Zustand's imperative reads are part of the discovery fence.
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getKnownExecutionHostIdForWorktree: (state: State) => state.host
}))
vi.mock('../right-sidebar/ai-vault-session-launch-target', () => ({
  resolveAiVaultTargetWorkspacePath: (state: State) => state.path
}))
vi.mock('@/lib/cursor-transcript-tab', async (original) => ({
  ...(await original<typeof TranscriptTabModule>()),
  openCursorTranscriptTab: mocks.open
}))
import { useAppStore } from '@/store'
import { CursorTranscriptDiscoveryGate } from './CursorTranscriptDiscoveryGate'
Object.assign(useAppStore, { getState: store.getState })

function session(id: string, overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return {
    id,
    sessionId: id,
    agent: 'cursor',
    executionHostId: 'local',
    cwd: '/work/worker',
    filePath: `/cursor/${id}.jsonl`,
    title: id,
    branch: null,
    model: null,
    codexHome: null,
    createdAt: null,
    updatedAt: null,
    modifiedAt: '2026-01-01T00:00:00Z',
    messageCount: 1,
    totalTokens: 0,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: '',
    subagent: null,
    ...overrides
  }
}
const result = (sessions: AiVaultSession[]): AiVaultListResult => ({
  sessions,
  issues: [],
  scannedAt: ''
})
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  store.setState({
    activeWorktreeId: 'worker',
    path: '/work/worker',
    host: 'local',
    workspaceSessionReady: true,
    unifiedTabsByWorktree: {},
    agentStatusByPaneKey: {}
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { aiVault: { listSessions: mocks.list } }
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('discovers the newest exact-workspace Cursor session once, without stealing the selected tab', async () => {
  const latest = session('latest', { modifiedAt: '2026-02-01T00:00:00Z' })
  mocks.list.mockResolvedValue(
    result([session('old'), latest, session('other', { cwd: '/work/other' })])
  )
  render(<CursorTranscriptDiscoveryGate />)
  await flush()
  expect(mocks.list).toHaveBeenCalledWith(
    expect.objectContaining({ scopePaths: ['/work/worker'], executionHostScope: 'local' })
  )
  expect(mocks.open).toHaveBeenCalledWith(latest, 'worker', false)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(mocks.open).toHaveBeenCalledOnce()
})

it('discards an old scan after a workspace change', async () => {
  let resolveOld = (_result: AiVaultListResult): void => {}
  mocks.list
    .mockReturnValueOnce(
      new Promise<AiVaultListResult>((resolve) => {
        resolveOld = resolve
      })
    )
    .mockResolvedValue(result([]))
  render(<CursorTranscriptDiscoveryGate />)
  await flush()
  await act(async () => {
    store.setState({ activeWorktreeId: 'other', path: '/work/other' })
  })
  await act(async () => {
    resolveOld(result([session('old')]))
  })
  expect(mocks.open).not.toHaveBeenCalled()
})

it('does not scan local history for a direct SSH workspace', async () => {
  store.setState({ host: 'ssh:remote' })
  render(<CursorTranscriptDiscoveryGate />)
  await flush()
  expect(mocks.list).not.toHaveBeenCalled()
})

it('keeps a session already represented by an Orca terminal in its existing pane', async () => {
  store.setState({
    unifiedTabsByWorktree: {
      worker: [
        {
          id: 'terminal',
          entityId: 'terminal',
          worktreeId: 'worker',
          groupId: 'group',
          contentType: 'terminal',
          label: 'Cursor',
          customLabel: null,
          color: null,
          sortOrder: 0,
          createdAt: 0
        }
      ]
    },
    agentStatusByPaneKey: { 'terminal:root': { providerSession: { id: 'one' } } }
  })
  mocks.list.mockResolvedValue(result([session('one')]))
  render(<CursorTranscriptDiscoveryGate />)
  await flush()
  expect(mocks.open).not.toHaveBeenCalled()
})
