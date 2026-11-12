// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../../../shared/constants'
import type { RuntimeMobileSessionTabsResult } from '../../../../shared/runtime-session-contracts'
import type { Tab } from '../../../../shared/tab-types'

import { applyLocalStructuredSessionTabSnapshots } from './snapshot-apply'
import { resetLocalStructuredSessionVersionForTests } from './inventory-generation-fence'
import './subscription'
import { resetWebSessionTabsSnapshotFreshnessForTests } from '../web-session-tabs-sync/tracking-lifecycle'
import type { WebSessionTabsSyncState } from '../web-session-tabs-sync/state'
import { resetWebSessionFocusIntentForTests } from '../web-session-tabs-sync/navigation/web-session-focus-intent'

const mocks = vi.hoisted(() => ({ recheckUnconfirmedLaunches: vi.fn() }))

vi.mock(
  '../../lib/agent-session/launch/structured-agent-session-launch-unconfirmed-recheck',
  () => ({
    recheckUnconfirmedStructuredAgentLaunches: mocks.recheckUnconfirmedLaunches
  })
)

const WORKTREE_ID = 'repo-1::worktree-1'
const TERMINAL_ID = 'terminal-1'
const STRUCTURED_ID = 'structured-agent-session-codex-1'
const PRIMARY_GROUP = 'primary-group'
const SECONDARY_GROUP = 'secondary-group'

afterEach(() => {
  resetLocalStructuredSessionVersionForTests()
  resetWebSessionFocusIntentForTests()
  resetWebSessionTabsSnapshotFreshnessForTests()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.restoreAllMocks()
})

function createSnapshot(): WebSessionTabsSyncState {
  const tabs: Tab[] = [
    {
      id: TERMINAL_ID,
      entityId: TERMINAL_ID,
      groupId: PRIMARY_GROUP,
      worktreeId: WORKTREE_ID,
      contentType: 'terminal',
      label: 'Terminal',
      customLabel: null,
      color: null,
      sortOrder: 0,
      createdAt: 1
    },
    {
      id: STRUCTURED_ID,
      entityId: 'codex-1',
      groupId: SECONDARY_GROUP,
      worktreeId: WORKTREE_ID,
      contentType: 'agent-session',
      agentSessionAgent: 'codex',
      label: 'Codex Chat',
      customLabel: null,
      color: null,
      sortOrder: 1,
      createdAt: 2
    }
  ]
  return {
    activeBrowserTabId: null,
    activeBrowserTabIdByWorktree: {},
    activeFileId: null,
    activeFileIdByWorktree: {},
    activeGroupIdByWorktree: { [WORKTREE_ID]: SECONDARY_GROUP },
    activeTabId: STRUCTURED_ID,
    activeTabIdByWorktree: { [WORKTREE_ID]: STRUCTURED_ID },
    activeTabType: 'agent-session',
    activeTabTypeByWorktree: { [WORKTREE_ID]: 'agent-session' },
    activeWorktreeId: WORKTREE_ID,
    agentStatusByPaneKey: {},
    agentStatusEpoch: 0,
    browserCertificateFailuresByPageId: {},
    browserPagesByWorkspace: {},
    browserTabsByWorktree: {},
    groupsByWorktree: {
      [WORKTREE_ID]: [
        {
          id: PRIMARY_GROUP,
          worktreeId: WORKTREE_ID,
          activeTabId: TERMINAL_ID,
          tabOrder: [TERMINAL_ID]
        },
        {
          id: SECONDARY_GROUP,
          worktreeId: WORKTREE_ID,
          activeTabId: STRUCTURED_ID,
          tabOrder: [STRUCTURED_ID]
        }
      ]
    },
    layoutByWorktree: {
      [WORKTREE_ID]: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', groupId: PRIMARY_GROUP },
        second: { type: 'leaf', groupId: SECONDARY_GROUP }
      }
    },
    openFiles: [],
    editorBuffers: {},
    ptyIdsByTabId: { [TERMINAL_ID]: ['pty-1'] },
    remoteBrowserPageHandlesByPageId: {},
    tabBarOrderByWorktree: { [WORKTREE_ID]: [TERMINAL_ID, STRUCTURED_ID] },
    tabsByWorktree: {},
    terminalLayoutsByTabId: {},
    unifiedTabsByWorktree: { [WORKTREE_ID]: tabs },
    unreadTerminalTabs: {},
    sortEpoch: 0
  }
}

function structuredInventory(
  publicationEpoch: string,
  snapshotVersion: number,
  sessionId: string
): RuntimeMobileSessionTabsResult {
  return {
    worktree: WORKTREE_ID,
    publicationEpoch,
    snapshotVersion,
    activeGroupId: SECONDARY_GROUP,
    activeTabId: `agent-session:${sessionId}`,
    activeTabType: 'agent-session',
    tabGroups: [
      {
        id: SECONDARY_GROUP,
        activeTabId: `agent-session:${sessionId}`,
        tabOrder: [`agent-session:${sessionId}`]
      }
    ],
    tabs: [
      {
        type: 'agent-session',
        id: `agent-session:${sessionId}`,
        title: 'Codex Chat',
        sessionId,
        agent: 'codex',
        isActive: true
      }
    ]
  }
}

describe('local structured session tab projection', () => {
  it('preserves external transcript tabs when the structured inventory is replaced', () => {
    const state = createSnapshot()
    const tab = state.unifiedTabsByWorktree[WORKTREE_ID][1]
    tab.agentSessionAgent = 'cursor'
    tab.agentTranscript = {
      agent: 'cursor',
      sessionId: 'external-worker',
      transcriptPath: '/cursor/worker.jsonl',
      runtimeEnvironmentId: null
    }
    const mirrored = applyLocalStructuredSessionTabSnapshots(state, [
      structuredInventory('epoch-1', 1, 'codex-2')
    ])
    expect(mirrored.unifiedTabsByWorktree[WORKTREE_ID]).toContainEqual(tab)
  })
})
