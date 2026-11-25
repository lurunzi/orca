import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repository/repo-types'
import '../../../../shared/agent-status/identity/agent-kind'
import { getDefaultSettings } from '../../../../shared/orca-profiles/constants'

import type { AgentLaunchRuntime } from '../../../../shared/agent-launch/startup/agent-launch-runtime'

const mocks = vi.hoisted(() => ({
  detectInstalledAgentsWithShellPathHydration: vi.fn(),
  capabilities: vi.fn(),
  executable: vi.fn(),
  modelContext: vi.fn()
}))

vi.mock('../../../preflight/agent-detection', () => ({
  detectInstalledAgentsWithShellPathHydration: mocks.detectInstalledAgentsWithShellPathHydration
}))

vi.mock('../../../opencode/model-launch/opencode-launch-capabilities', () => ({
  probeOpenCodeLaunchCapabilities: mocks.capabilities
}))
vi.mock('../../../opencode/model-launch/opencode-model-executable', () => ({
  resolveOpenCodeDirectModelExecutable: mocks.executable
}))
vi.mock('../../../opencode/model-launch/opencode-launch-model-context', () => ({
  probeOpenCodeLaunchModelContext: mocks.modelContext
}))

import {
  buildWorktreeStartupForAgent,
  buildWorktreeStartupForDraft
} from './runtime-worktree-agent-startup'

function makeRepo(fields: Partial<Repo>): Repo {
  return {
    id: 'repo-1',
    displayName: 'repo',
    badgeColor: '#737373',
    addedAt: 0,
    path: '/srv/repo',
    connectionId: null,
    executionHostId: null,
    ...fields
  }
}

const LINUX_FACT: AgentLaunchRuntime = {
  platform: 'linux',
  pty: { shellOverride: undefined, terminalWindowsWslDistro: null }
}
const LINUX = { platform: 'linux' as const, shell: 'posix' as const, launchRuntime: LINUX_FACT }

const settings = {
  ...getDefaultSettings('/tmp'),
  agentCmdOverrides: {},
  agentDefaultArgs: {},
  agentDefaultEnv: {},
  disabledTuiAgents: [],
  defaultTuiAgent: null
}

describe('buildWorktreeStartupForAgent Antigravity view', () => {
  it.each([
    { connectionId: null, enabled: true, expected: 'chat' },
    { connectionId: 'ssh-target', enabled: true, expected: undefined },
    { connectionId: null, enabled: false, expected: undefined }
  ])(
    'opens Antigravity with the readable configured view: %j',
    async ({ connectionId, enabled, expected }) => {
      const result = await buildWorktreeStartupForAgent({
        repo: makeRepo({ connectionId }),
        settings: { ...settings, agentDefaultSurface: enabled ? 'chat' : 'terminal' },
        agent: 'antigravity',
        getLaunchRuntime: () => LINUX,
        toSessionOptions: () => undefined
      })
      expect(result.startup.viewMode).toBe(expected)
    }
  )

  it('opens an Antigravity startup draft in chat', async () => {
    const result = await buildWorktreeStartupForDraft({
      repo: makeRepo({}),
      settings: { ...settings, agentDefaultSurface: 'chat' },
      requestedAgent: 'antigravity',
      draft: 'inspect this repository',
      getLaunchRuntime: () => LINUX
    })
    expect(result?.startup.viewMode).toBe('chat')
  })
})
