import { expect, it, vi } from 'vitest'
import { ANTIGRAVITY_ACP_RUNTIME } from '../antigravity/antigravity-acp-runtime'
import { decideAgentLaunchMode } from './agent-launch-mode'

vi.mock('electron', () => ({ app: { getPath: () => '/orca-state', isPackaged: true } }))

it('launches Antigravity as a terminal where its chat server has no build for this host', () => {
  const mode = decideAgentLaunchMode({
    placement: { agent: 'antigravity' },
    settings: { experimentalNativeChat: true }
  }).mode
  expect(mode).toBe(ANTIGRAVITY_ACP_RUNTIME.pin() === null ? 'terminal' : 'structured')
})
