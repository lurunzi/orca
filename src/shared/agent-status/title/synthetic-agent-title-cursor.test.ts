import { describe, expect, it } from 'vitest'
import {
  getSyntheticAgentTerminalTitle,
  shouldDriveSyntheticAgentTitleFromHook
} from './synthetic-agent-title'

describe('synthetic Cursor titles', () => {
  it('preserves Cursor working titles while retaining completion and permission signals', () => {
    expect(shouldDriveSyntheticAgentTitleFromHook('cursor', 'working')).toBe(false)
    for (const state of ['done', 'waiting', 'blocked'] as const) {
      expect(shouldDriveSyntheticAgentTitleFromHook('cursor', state)).toBe(true)
    }
    expect(getSyntheticAgentTerminalTitle('cursor', 'done')).toBe('Cursor ready')
    expect(getSyntheticAgentTerminalTitle('cursor', 'waiting')).toBe('Cursor - action required')
    expect(getSyntheticAgentTerminalTitle('cursor', 'blocked')).toBe('Cursor - action required')
  })
})
