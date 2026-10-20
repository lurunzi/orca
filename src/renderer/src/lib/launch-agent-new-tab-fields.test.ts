import { expect, it, vi } from 'vitest'
import { newTabLaunchFields } from './launch-agent-new-tab-fields'
import type { AgentLaunchExecutionContext } from './launch-agent-execution-context'

vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ settings: { experimentalNativeChat: true } }) }
}))

const context: AgentLaunchExecutionContext = {
  worktreeSshConnectionId: null,
  resolvedLaunchPlatform: 'win32',
  isRemote: false,
  queuedShell: undefined
}

it.each(['cursor', 'antigravity'] as const)(
  'carries %s chat view to both local and host-routed launches',
  (agent) => {
    const fields = newTabLaunchFields({ agent }, context, 'auto-submit')
    expect(fields.viewMode).toBe('chat')
    expect(fields.tab.viewMode).toBe('chat')
    expect(fields.hostRoute.viewMode).toBe('chat')
  }
)

it.each(['cursor', 'antigravity'] as const)(
  'keeps an explicitly requested %s CLI in the terminal',
  (agent) => {
    const fields = newTabLaunchFields(
      { agent, requestedSurface: 'terminal' },
      context,
      'auto-submit'
    )
    expect(fields.viewMode).toBeUndefined()
    expect(fields.tab.viewMode).toBeUndefined()
    expect(fields.hostRoute.viewMode).toBeUndefined()
  }
)

it('does not offer a transcript chat for an unreadable SSH transcript', () => {
  expect(
    newTabLaunchFields(
      { agent: 'cursor' },
      {
        ...context,
        worktreeSshConnectionId: 'ssh-target',
        isRemote: true
      },
      'draft'
    ).viewMode
  ).toBeUndefined()
})

it('retains the terminal choice when a saved launch plan is used after workspace creation', () => {
  expect(
    newTabLaunchFields(
      {
        agent: 'cursor',
        agentSessionLaunchPlan: { requestedSurface: 'terminal' }
      },
      context,
      'draft'
    ).viewMode
  ).toBeUndefined()
})
