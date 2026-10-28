import { describe, expect, it } from 'vitest'
import {
  getSyntheticAgentTerminalTitle,
  isSyntheticAgentPermissionTitle,
  shouldDriveSyntheticAgentTitleFromHook
} from './synthetic-agent-title'

describe('synthetic agent titles', () => {
  it.each(['Codex - action required', ' Pi - action required ', 'OMP - action required'])(
    'recognizes the generated permission label %s',
    (title) => {
      expect(isSyntheticAgentPermissionTitle(title)).toBe(true)
    }
  )

  it.each([
    '✋ Gemini CLI',
    'π ! approve command',
    'OpenCode - action required',
    'Codex ready',
    'Codex - action required for deployment'
  ])('keeps native and contextual titles outside generated permission suppression: %s', (title) => {
    expect(isSyntheticAgentPermissionTitle(title)).toBe(false)
  })

  it('does not synthesize Codex working titles over Codex native spinner titles', () => {
    expect(shouldDriveSyntheticAgentTitleFromHook('codex', 'working')).toBe(false)
    expect(shouldDriveSyntheticAgentTitleFromHook('codex', 'done')).toBe(true)
  })

  it('preserves Cursor working titles while retaining completion and permission signals', () => {
    expect(shouldDriveSyntheticAgentTitleFromHook('cursor', 'working')).toBe(false)
    for (const state of ['done', 'waiting', 'blocked'] as const) {
      expect(shouldDriveSyntheticAgentTitleFromHook('cursor', state)).toBe(true)
    }
    expect(getSyntheticAgentTerminalTitle('cursor', 'done')).toBe('Cursor ready')
    expect(getSyntheticAgentTerminalTitle('cursor', 'waiting')).toBe('Cursor - action required')
    expect(getSyntheticAgentTerminalTitle('cursor', 'blocked')).toBe('Cursor - action required')
  })

  it('does not synthesize OpenCode titles over native session titles', () => {
    expect(getSyntheticAgentTerminalTitle('opencode', 'done')).toBeNull()
    expect(getSyntheticAgentTerminalTitle('opencode', 'waiting')).toBeNull()
    expect(shouldDriveSyntheticAgentTitleFromHook('opencode', 'working')).toBe(false)
    expect(shouldDriveSyntheticAgentTitleFromHook('opencode', 'done')).toBe(false)
    expect(shouldDriveSyntheticAgentTitleFromHook('opencode', 'waiting')).toBe(false)
  })
})
