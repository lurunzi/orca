import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPreflightAgentTrust = vi.fn()
const mockCreateTab = vi.fn()

const worktrees = [
  {
    id: 'wt-1',
    repoId: 'repo-1',
    projectId: 'repo-1',
    path: '/repo/worktree',
    displayName: 'main'
  }
]

type TestFolderWorkspace = {
  id: string
  folderPath: string
  projectGroupId: string
  connectionId?: string | null
}

const folderWorkspaces: TestFolderWorkspace[] = []

const store = {
  activeRepoId: 'repo-1',
  activeWorktreeId: 'wt-1',
  settings: {
    agentCmdOverrides: {},
    agentDefaultArgs: {},
    agentDefaultEnv: {},
    activeRuntimeEnvironmentId: null as string | null
  },
  repos: [{ id: 'repo-1', connectionId: null as string | null, path: '/repo' }],
  worktreesByRepo: { 'repo-1': worktrees },
  allWorktrees: vi.fn(() => worktrees),
  folderWorkspaces,
  projectGroups: [{ id: 'pg-1' }],
  tabsByWorktree: { 'wt-1': [{ id: 'tab-1' }] },
  openFiles: [] as { id: string; worktreeId: string }[],
  browserTabsByWorktree: {} as Record<string, { id: string }[]>,
  tabBarOrderByWorktree: {} as Record<string, string[]>,
  createTab: mockCreateTab,
  queueTabStartupCommand: vi.fn(),
  queueTabInitialCwd: vi.fn(),
  setActiveTabType: vi.fn(),
  setTabBarOrder: vi.fn()
}

vi.mock('@/store', () => ({
  useAppStore: { getState: () => store }
}))

vi.mock('@/lib/new-workspace', () => ({ CLIENT_PLATFORM: 'darwin' }))

vi.mock('@/runtime/web-runtime-session', () => ({
  isWebRuntimeSessionActive: vi.fn(() => false)
}))

vi.mock('@/lib/agent-trust-preflight', () => ({
  preflightAgentTrust: (...args: unknown[]) => mockPreflightAgentTrust(...args)
}))

vi.mock('@/components/tab-bar/reconcile-order', () => ({
  reconcileTabOrder: (_stored: unknown, terminalIds: string[]) => terminalIds
}))

vi.mock('@/lib/telemetry', () => ({
  track: vi.fn(),
  tuiAgentToAgentKind: (agent: string) => agent
}))

vi.mock('@/components/native-chat/native-chat-session-option-cache', () => ({
  seedNativeChatAppliedSessionOptions: vi.fn()
}))

describe('launchAgentInNewTab trust preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.repos = [{ id: 'repo-1', connectionId: null, path: '/repo' }]
    store.folderWorkspaces = []
    mockCreateTab.mockReturnValue({ id: 'tab-1' })
    mockPreflightAgentTrust.mockResolvedValue(undefined)
  })

  it('preflights agent workspace trust for the target worktree before launch', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({
      agent: 'antigravity',
      worktreeId: 'wt-1'
    })

    expect(mockPreflightAgentTrust).toHaveBeenCalledWith({
      agent: 'antigravity',
      workspacePath: '/repo/worktree',
      connectionId: null
    })
  })

  it('preflights agent workspace trust for folder workspaces', async () => {
    store.folderWorkspaces = [
      {
        id: 'folder-1',
        folderPath: '/custom/folder/path',
        projectGroupId: 'pg-1'
      }
    ]
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({
      agent: 'antigravity',
      worktreeId: 'folder:folder-1'
    })

    expect(mockPreflightAgentTrust).toHaveBeenCalledWith({
      agent: 'antigravity',
      workspacePath: '/custom/folder/path',
      connectionId: null
    })
  })

  it('forwards SSH connection id to agent trust preflight for remote worktrees', async () => {
    store.repos = [{ id: 'repo-1', connectionId: 'ssh-target-1', path: '/repo' }]
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({
      agent: 'antigravity',
      worktreeId: 'wt-1'
    })

    expect(mockPreflightAgentTrust).toHaveBeenCalledWith({
      agent: 'antigravity',
      workspacePath: '/repo/worktree',
      connectionId: 'ssh-target-1'
    })
  })

  it('preflights both workspacePath and initialCwd when initialCwd differs from workspace root', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({
      agent: 'antigravity',
      worktreeId: 'wt-1',
      initialCwd: '/repo/worktree/packages/subproject'
    })

    expect(mockPreflightAgentTrust).toHaveBeenCalledWith({
      agent: 'antigravity',
      workspacePath: '/repo/worktree',
      connectionId: null
    })
    expect(mockPreflightAgentTrust).toHaveBeenCalledWith({
      agent: 'antigravity',
      workspacePath: '/repo/worktree/packages/subproject',
      connectionId: null
    })
  })
})
