import { expect, it, vi } from 'vitest'
import { decideAgentLaunchMode } from './agent-launch-mode'

vi.mock('electron', () => ({ app: { getPath: () => '/orca-state', isPackaged: true } }))

// Hosts without a managed build run the installed agy; the host's create support decides the rest.
it('routes an Antigravity chat launch to a structured chat on every host', () => {
  const mode = decideAgentLaunchMode({
    placement: { agent: 'antigravity' },
    settings: { agentDefaultSurface: 'chat' }
  }).mode
  expect(mode).toBe('structured')
})
