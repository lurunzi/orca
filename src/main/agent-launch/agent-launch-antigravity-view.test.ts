import { expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'
import { executeAgentLaunch, type AgentLaunchExecution } from './agent-launch-executor'

it.each([
  { connectionId: null, enabled: true, viewMode: 'chat' },
  { connectionId: 'runtime-ssh-env-1', enabled: true, viewMode: 'chat' },
  { connectionId: 'ssh-target-1', enabled: true, viewMode: 'terminal' },
  { connectionId: null, enabled: false, viewMode: 'terminal' }
])(
  'uses $viewMode for an Antigravity launch on $connectionId (chat=$enabled)',
  async (scenario) => {
    const createTerminalAgent = vi.fn(async () => ({ handle: 'terminal-1' }))
    const createStructuredSession = vi.fn(async () => ({
      sessionId: 'unused',
      handle: 'unused',
      fence: 1
    }))
    const runtime: AgentLaunchExecution['runtime'] = {
      requireStore: () => ({
        getSettings: () => ({
          ...getDefaultSettings('/tmp'),
          experimentalNativeChat: scenario.enabled
        })
      }),
      getStructuredAgentSessionCreateSupport: vi.fn(async () => ({
        supported: false,
        reason: 'agent' as const
      }))
    }
    const result = await executeAgentLaunch({
      runtime,
      intent: {
        agent: 'antigravity',
        target: {
          kind: 'existing',
          worktree: 'folder:workspace',
          connectionId: scenario.connectionId
        }
      },
      surfaces: {
        createTerminalAgent,
        createStructuredSession,
        deliverTerminalPrompt: vi.fn(async () => true)
      }
    })
    expect(result.outcome).toEqual({ kind: 'terminal', handle: 'terminal-1' })
    expect(createTerminalAgent).toHaveBeenCalledWith(
      expect.objectContaining({ viewMode: scenario.viewMode })
    )
    expect(createStructuredSession).not.toHaveBeenCalled()
  }
)
