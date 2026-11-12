import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as LaunchAgentKindModule from '../../../../../../shared/agent-kind'

const mockIsWebRuntimeSessionActive = vi.fn(() => false)
const mockCreateTab = vi.fn()
const mockPasteDraftWhenAgentReady = vi.fn()

const store = {
  activeRepoId: 'repo-1',
  activeWorktreeId: 'wt-1',
  settings: {
    agentCmdOverrides: {},
    agentDefaultArgs: {} as Record<string, string>,
    agentDefaultEnv: {} as Record<string, Record<string, string>>,
    activeRuntimeEnvironmentId: null as string | null
  } as {
    agentCmdOverrides: Record<string, string>
    agentDefaultArgs: Record<string, string>
    agentDefaultEnv: Record<string, Record<string, string>>
    activeRuntimeEnvironmentId: string | null
    terminalWindowsShell?: string
  },
  projects: [
    {
      id: 'repo-1',
      localWindowsRuntimePreference: { kind: 'inherit-global' as const }
    }
  ] as {
    id: string
    localWindowsRuntimePreference:
      | { kind: 'inherit-global' }
      | { kind: 'windows-host' }
      | { kind: 'wsl'; distro: string | null }
  }[],
  repos: [{ id: 'repo-1', connectionId: null as string | null, path: '/repo' }],
  sshConnectionStates: new Map([['ssh-a', { status: 'connected', remotePlatform: 'linux' }]]),
  transientClearedAgentStatusConnectionIds: {} as Record<string, true>,
  sshStateByEnvironment: new Map(),
  runtimeStatusByEnvironmentId: new Map([['web-runtime', { status: { hostPlatform: 'linux' } }]]),
  worktreesByRepo: {
    'repo-1': [
      {
        id: 'wt-1',
        repoId: 'repo-1',
        projectId: 'repo-1',
        path: '/repo/worktree',
        displayName: 'main'
      }
    ]
  },
  allWorktrees: vi.fn(() => store.worktreesByRepo['repo-1']),
  tabsByWorktree: {
    'wt-1': [{ id: 'tab-1' }]
  },
  unifiedTabsByWorktree: {},
  openFiles: [] as { id: string; worktreeId: string }[],
  browserTabsByWorktree: {} as Record<string, { id: string }[]>,
  tabBarOrderByWorktree: {} as Record<string, string[]>,
  terminalLayoutsByTabId: {} as Record<
    string,
    { activeLeafId: string | null; ptyIdsByLeafId?: Record<string, string> }
  >,
  ptyIdsByTabId: {} as Record<string, string[]>,
  createTab: mockCreateTab,
  closeTab: vi.fn(),
  setActiveTabType: vi.fn(),
  setTabBarOrder: vi.fn(),
  setAgentStatus: vi.fn(),
  seedNativeChatLaunchPrompt: vi.fn(),
  seedNativeChatLaunchDraft: vi.fn(),
  markNativeChatLaunchPromptFailed: vi.fn()
}

vi.mock('@/store/index', () => ({
  useAppStore: {
    getState: () => store
  }
}))

vi.mock('sonner', () => ({
  toast: { message: vi.fn(), error: vi.fn() }
}))

vi.mock('@/components/tab-bar/reconcile-order', () => ({
  reconcileTabOrder: vi.fn(
    (_stored, termIds: string[], editorIds: string[], browserIds: string[]) => [
      ...termIds,
      ...editorIds,
      ...browserIds
    ]
  )
}))

vi.mock('@/lib/agent-session/messaging/paste/agent-paste-draft', () => ({
  pasteDraftWhenAgentReady: mockPasteDraftWhenAgentReady
}))

vi.mock('@/diagnostics/telemetry/telemetry', () => ({ track: vi.fn() }))
const mockLaunchAgentKind = vi.hoisted(() => (agent: string) => agent)
vi.mock('../../../../../../shared/agent-kind', async (importOriginal) => ({
  ...(await importOriginal<typeof LaunchAgentKindModule>()),
  tuiAgentToAgentKind: mockLaunchAgentKind
}))

vi.mock('@/runtime/hosted-terminals/creation/web-runtime-terminal-creation', () => ({
  createWebRuntimeSessionTerminal: vi.fn()
}))
vi.mock('@/runtime/hosted-terminals/creation/web-runtime-created-agent-prompt-delivery', () => ({
  deliverCreatedWebRuntimeAgentSessionPrompt: vi.fn(async () => true)
}))
vi.mock('@/runtime/web-session-tabs-sync/identity/web-runtime-session-environment', () => ({
  isWebRuntimeSessionActive: mockIsWebRuntimeSessionActive
}))
vi.mock('../../../../../../shared/workspace-layout/terminal-surface-id', () => ({
  isWebTerminalSurfaceTabId: vi.fn(() => false)
}))

describe('launchAgentInNewTab Windows shell quoting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsWebRuntimeSessionActive.mockReturnValue(false)
    store.activeRepoId = 'repo-1'
    store.activeWorktreeId = 'wt-1'
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: null
    }
    store.projects = [
      {
        id: 'repo-1',
        localWindowsRuntimePreference: { kind: 'inherit-global' }
      }
    ]
    store.repos = [{ id: 'repo-1', connectionId: null, path: '/repo' }]
    store.sshConnectionStates = new Map([
      ['ssh-a', { status: 'connected', remotePlatform: 'linux' }]
    ])
    store.transientClearedAgentStatusConnectionIds = {}
    store.worktreesByRepo = {
      'repo-1': [
        {
          id: 'wt-1',
          repoId: 'repo-1',
          projectId: 'repo-1',
          path: '/repo/worktree',
          displayName: 'main'
        }
      ]
    }
    store.tabsByWorktree = { 'wt-1': [{ id: 'tab-1' }] }
    store.openFiles = []
    store.browserTabsByWorktree = {}
    store.tabBarOrderByWorktree = {}
    store.terminalLayoutsByTabId = {}
    store.ptyIdsByTabId = {}
    mockCreateTab.mockReturnValue({ id: 'tab-1' })
    mockPasteDraftWhenAgentReady.mockResolvedValue(true)
  })

  it.each(['win32', 'linux', 'darwin'] as const)(
    'passes the %s execution platform to launch prompt delivery',
    async (launchPlatform) => {
      const { launchAgentInNewTabWithOutcome } = await import('./launch-agent-in-new-tab')
      launchAgentInNewTabWithOutcome({
        requestId: `request-${launchPlatform}`,
        agent: 'codex',
        worktreeId: 'wt-1',
        prompt: 'Continue work\nRead the original transcript',
        promptDelivery: 'submit-after-ready',
        launchPlatform
      })
      expect(mockPasteDraftWhenAgentReady).toHaveBeenCalledWith(
        expect.objectContaining({ hostPlatform: launchPlatform, submit: true })
      )
    }
  )

  // Node tests resolve POSIX here; verify single-quote escaping in configured default arguments.
})
