import { describe, expect, it } from 'vitest'
import type { RuntimeMobileSessionTabsResult } from '../../../../shared/runtime-types'
import type { Tab } from '../../../../shared/tab-types'
import { buildMirroredAgentTabs } from './terminal-surfaces'

const WORKTREE = 'repo-1::worktree-1'
const GROUP = 'group-1'

function snapshotWith(agent: 'claude' | 'codex', title: string): RuntimeMobileSessionTabsResult {
  return {
    worktree: WORKTREE,
    publicationEpoch: 'epoch-1',
    snapshotVersion: 1,
    activeGroupId: GROUP,
    activeTabId: null,
    activeTabType: null,
    tabs: [
      {
        type: 'agent-session',
        id: 'host-tab-1',
        title,
        sessionId: `${agent}-1`,
        agent,
        isActive: false
      }
    ]
  } as RuntimeMobileSessionTabsResult
}

function build(
  snapshot: RuntimeMobileSessionTabsResult,
  currentUnifiedTabs: readonly Tab[] = []
): Tab {
  const [mirrored] = buildMirroredAgentTabs(
    snapshot,
    'runtime:env-1',
    new Map(),
    GROUP,
    0,
    currentUnifiedTabs,
    1_000
  )
  return mirrored.unifiedTab
}

describe('buildMirroredAgentTabs', () => {
  it('preserves a resolved title only for the same host and conversation', () => {
    const snapshot = snapshotWith('claude', 'Claude Chat')
    const existing: Tab = {
      ...build(snapshot),
      aiVaultTitle: { agent: 'claude', sessionId: 'provider-1', title: 'Synced title' }
    }
    expect(build(snapshot, [existing]).aiVaultTitle).toEqual(existing.aiVaultTitle)
    expect(
      build(snapshot, [{ ...existing, executionHostId: 'local' }]).aiVaultTitle
    ).toBeUndefined()
    expect(
      build(snapshot, [{ ...existing, agentSessionAgent: 'codex' }]).aiVaultTitle
    ).toBeUndefined()
    const hostTab = snapshot.tabs[0]
    if (hostTab.type !== 'agent-session') {
      throw new Error('Expected a chat')
    }
    const replacement = {
      ...snapshot,
      tabs: [{ ...hostTab, sessionId: 'replacement', replacesSessionId: 'claude-1' }]
    }
    const replaced = build(replacement, [existing])
    expect(replaced.id).toBe(existing.id)
    expect(replaced.aiVaultTitle).toBeUndefined()
  })
})
