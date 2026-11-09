import { expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'
import type { AgentLaunchSurface } from '../../shared/agent-launch/contracts/agent-launch-surface'
import { executeAgentLaunch, type AgentLaunchExecution } from './agent-launch-executor'

function launchAntigravity(input: {
  connectionId: string | null
  enabled: boolean
  hostSupportsChat: boolean
  surface?: AgentLaunchSurface
}) {
  const createTerminalAgent = vi.fn(async () => ({ handle: 'terminal-1' }))
  const createStructuredSession = vi.fn(async () => ({
    sessionId: 'session-1',
    handle: 'structured-1',
    fence: 1
  }))
  const runtime: AgentLaunchExecution['runtime'] = {
    requireStore: () => ({
      getSettings: () => ({
        ...getDefaultSettings('/tmp'),
        agentDefaultSurface: input.enabled ? 'chat' : 'terminal'
      })
    }),
    getStructuredAgentSessionCreateSupport: vi.fn(async () =>
      input.hostSupportsChat ? { supported: true } : { supported: false, reason: 'agent' as const }
    )
  }
  const result = executeAgentLaunch({
    runtime,
    intent: {
      agent: 'antigravity',
      ...(input.surface ? { surface: input.surface } : {}),
      target: { kind: 'existing', worktree: 'folder:workspace', connectionId: input.connectionId }
    },
    surfaces: {
      createTerminalAgent,
      createStructuredSession,
      deliverTerminalPrompt: vi.fn(async () => true)
    }
  })
  return { result, createTerminalAgent, createStructuredSession }
}

it.each([
  { connectionId: null, enabled: true, viewMode: 'chat' },
  { connectionId: 'runtime-ssh-env-1', enabled: true, viewMode: 'chat' },
  { connectionId: 'ssh-target-1', enabled: true, viewMode: 'terminal' },
  { connectionId: null, enabled: false, viewMode: 'terminal' }
])(
  'uses $viewMode for an Antigravity launch on $connectionId (chat=$enabled)',
  async (scenario) => {
    const launch = launchAntigravity({ ...scenario, hostSupportsChat: false })
    expect((await launch.result).outcome).toEqual({ kind: 'terminal', handle: 'terminal-1' })
    expect(launch.createTerminalAgent).toHaveBeenCalledWith(
      expect.objectContaining({ viewMode: scenario.viewMode })
    )
    expect(launch.createStructuredSession).not.toHaveBeenCalled()
  }
)

it('opens the structured chat when the host runs Antigravity chats', async () => {
  for (const surface of [undefined, 'chat'] as const) {
    const launch = launchAntigravity({
      connectionId: null,
      enabled: true,
      hostSupportsChat: true,
      surface
    })
    expect((await launch.result).outcome).toMatchObject({ kind: 'structured' })
    expect(launch.createTerminalAgent).not.toHaveBeenCalled()
  }
})

it('keeps an explicit terminal launch a terminal view', async () => {
  const launch = launchAntigravity({
    connectionId: null,
    enabled: true,
    hostSupportsChat: true,
    surface: 'terminal'
  })
  expect((await launch.result).outcome).toEqual({ kind: 'terminal', handle: 'terminal-1' })
  expect(launch.createTerminalAgent).toHaveBeenCalledWith(
    expect.objectContaining({ viewMode: 'terminal' })
  )
  expect(launch.createStructuredSession).not.toHaveBeenCalled()
})
