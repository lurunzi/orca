import { beforeEach, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../shared/ai-vault-types'
import type { ExecutionHostId } from '../../../shared/execution-host'
import { parseWorkspaceSession } from '../../../shared/workspace-session-schema'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { createTabsSliceMockApi } from '@/store/slices/tabs-slice-test-harness'
import type * as WorktreeOwnerModule from './worktree-runtime-owner'
import type * as RetirementModule from '@/runtime/structured-agent-session-tab-retirement'
import type * as RpcModule from '@/runtime/runtime-rpc-client'

const mocks = vi.hoisted(() => {
  const owner: { host: ExecutionHostId } = { host: 'local' }
  return { ...owner, retire: vi.fn(), rpc: vi.fn() }
})
let store: ReturnType<typeof createTestStore>
vi.mock('@/store', () => ({ useAppStore: { getState: () => store.getState() } }))
vi.mock('./worktree-runtime-owner', async (original) => ({
  ...(await original<typeof WorktreeOwnerModule>()),
  getKnownExecutionHostIdForWorktree: () => mocks.host
}))
vi.mock('@/runtime/structured-agent-session-tab-retirement', async (original) => ({
  ...(await original<typeof RetirementModule>()),
  beginStructuredAgentSessionTabClose: mocks.retire
}))
vi.mock('@/runtime/runtime-rpc-client', async (original) => ({
  ...(await original<typeof RpcModule>()),
  callRuntimeRpc: mocks.rpc
}))
import { cursorSessionMatchesWorkspace, openCursorTranscriptTab } from './cursor-transcript-tab'
import { activateStructuredAgentSessionTab } from './structured-agent-session-tab-activation'

const api = createTabsSliceMockApi()
const WT = 'folder:worker'
const PATH = 'C:/work/worker'
const session: AiVaultSession = {
  id: 'cursor:one',
  agent: 'cursor',
  sessionId: 'one',
  executionHostId: 'local',
  cwd: PATH,
  filePath: 'C:/cursor/one.jsonl',
  title: 'Worker task',
  branch: null,
  model: null,
  codexHome: null,
  createdAt: null,
  updatedAt: null,
  modifiedAt: '2026-01-01T00:00:00Z',
  messageCount: 2,
  totalTokens: 0,
  previewMessages: [],
  queuedMessageCount: 0,
  subagentTranscriptCount: 0,
  resumeCommand: 'cursor-agent --resume one',
  subagent: null
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.host = 'local'
  store = createTestStore()
  store.setState({
    folderWorkspaces: [
      {
        id: 'worker',
        folderPath: PATH,
        name: 'Worker',
        projectGroupId: 'project',
        linkedTask: null,
        comment: '',
        isArchived: false,
        isUnread: false,
        isPinned: false,
        sortOrder: 0,
        lastActivityAt: 0,
        createdAt: 0,
        updatedAt: 0
      }
    ]
  })
})

it('opens, reuses, activates and closes a folder worker without controlling a process', () => {
  expect(openCursorTranscriptTab(session, WT)).toBe(true)
  const tab = store.getState().unifiedTabsByWorktree[WT][0]
  expect(tab.agentTranscript).toMatchObject({ sessionId: 'one', transcriptPath: session.filePath })
  expect(openCursorTranscriptTab(session, WT)).toBe(true)
  expect(store.getState().unifiedTabsByWorktree[WT]).toHaveLength(1)
  expect(activateStructuredAgentSessionTab({ worktreeId: WT, tabId: tab.id })).toBe(true)
  expect(store.getState().reconcileWorktreeTabModel(WT).renderableTabCount).toBe(1)
  store.getState().closeUnifiedTab(tab.id)
  expect(store.getState().unifiedTabsByWorktree[WT]).toHaveLength(0)
  expect(mocks.retire).not.toHaveBeenCalled()
  expect(mocks.rpc).not.toHaveBeenCalled()
  expect(api.pty.spawn).not.toHaveBeenCalled()
  expect(api.pty.kill).not.toHaveBeenCalled()
})

it('retains the exact transcript and execution host across persistence', () => {
  expect(openCursorTranscriptTab(session, WT)).toBe(true)
  const tab = store.getState().unifiedTabsByWorktree[WT][0]
  const parsed = parseWorkspaceSession({
    activeRepoId: null,
    activeWorktreeId: WT,
    activeTabId: null,
    tabsByWorktree: {},
    terminalLayoutsByTabId: {},
    unifiedTabs: { [WT]: [tab] }
  })
  expect(parsed.ok).toBe(true)
  if (parsed.ok) {
    expect(parsed.value.unifiedTabs?.[WT][0]).toMatchObject(tab)
  }
})

it('routes a paired host to its own transcript transport and rejects other hosts', () => {
  mocks.host = 'runtime:remote'
  expect(openCursorTranscriptTab(session, WT)).toBe(false)
  expect(openCursorTranscriptTab({ ...session, executionHostId: mocks.host }, WT)).toBe(true)
  expect(store.getState().unifiedTabsByWorktree[WT][0].agentTranscript?.runtimeEnvironmentId).toBe(
    'remote'
  )
  mocks.host = 'ssh:remote'
  expect(openCursorTranscriptTab({ ...session, executionHostId: mocks.host }, WT)).toBe(false)
})

it('matches Windows path variants without matching a different workspace or provider', () => {
  expect(cursorSessionMatchesWorkspace(session, 'c:\\work\\worker', 'local')).toBe(true)
  expect(cursorSessionMatchesWorkspace(session, `${PATH}-other`, 'local')).toBe(false)
  expect(cursorSessionMatchesWorkspace(session, PATH, 'runtime:other')).toBe(false)
  expect(cursorSessionMatchesWorkspace({ ...session, agent: 'codex' }, PATH, 'local')).toBe(false)
})
