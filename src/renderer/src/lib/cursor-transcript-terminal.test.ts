import { expect, it } from 'vitest'
import { findCursorTranscriptTerminal } from './cursor-transcript-terminal'
import { makePaneKey } from '../../../shared/workspace-layout/stable-pane-id'
import type { AgentStatusEntry } from '../../../shared/agent-status/contracts/agent-status-types'
import { acceptedAgentStatuses } from '@/store/slices/agent-status/accepted-agent-statuses'

const leaf = '11111111-1111-4111-8111-111111111111'
const paneKey = makePaneKey('tab', leaf)
const liveCursor: AgentStatusEntry = {
  paneKey,
  agentType: 'cursor',
  providerSession: { key: 'session_id', id: 'external' },
  state: 'done',
  prompt: '',
  updatedAt: 0,
  stateStartedAt: 0,
  stateHistory: []
}

function live(
  entry: AgentStatusEntry
): Parameters<typeof findCursorTranscriptTerminal>[0]['agentStatusByPaneKey'] {
  return acceptedAgentStatuses([[paneKey, entry]])
}

function fixture(): Parameters<typeof findCursorTranscriptTerminal>[0] {
  return {
    tabsByWorktree: {
      wt: [
        {
          id: 'tab',
          worktreeId: 'wt',
          title: 'Cursor',
          customTitle: null,
          ptyId: 'wrong-tab-primary',
          color: null,
          sortOrder: 0,
          createdAt: 0
        }
      ]
    },
    agentStatusByPaneKey: live(liveCursor),
    sleepingAgentSessionsByPaneKey: {
      [paneKey]: {
        paneKey,
        tabId: 'tab',
        worktreeId: 'wt',
        agent: 'cursor',
        providerSession: { key: 'session_id', id: 'external' },
        state: 'done',
        prompt: '',
        capturedAt: 0,
        updatedAt: 0,
        origin: 'live'
      }
    },
    terminalLayoutsByTabId: {
      tab: {
        root: { type: 'leaf', leafId: leaf },
        activeLeafId: leaf,
        expandedLeafId: null,
        ptyIdsByLeafId: { [leaf]: 'cursor-pty' }
      }
    }
  }
}

it('retains the exact pane after idle and a missing status publication', () => {
  const state = fixture()
  expect(findCursorTranscriptTerminal(state, 'wt', 'external')).toEqual({
    tabId: 'tab',
    paneKey,
    ptyId: 'cursor-pty'
  })
  state.agentStatusByPaneKey = acceptedAgentStatuses()
  expect(findCursorTranscriptTerminal(state, 'wt', 'external')?.ptyId).toBe('cursor-pty')
})

it('rejects another workspace, another session and a replaced agent', () => {
  const state = fixture()
  expect(findCursorTranscriptTerminal(state, 'other-workspace', 'external')).toBeNull()
  expect(findCursorTranscriptTerminal(state, 'wt', 'other-session')).toBeNull()
  state.agentStatusByPaneKey = live({ ...liveCursor, agentType: 'claude' })
  expect(findCursorTranscriptTerminal(state, 'wt', 'external')).toBeNull()
  state.agentStatusByPaneKey = live({
    ...liveCursor,
    providerSession: { key: 'session_id', id: 'replacement' }
  })
  expect(findCursorTranscriptTerminal(state, 'wt', 'external')).toBeNull()
})

it('keeps the conversation without redirecting a disconnected split to the primary PTY', () => {
  const state = fixture()
  state.terminalLayoutsByTabId.tab.ptyIdsByLeafId = {}
  expect(findCursorTranscriptTerminal(state, 'wt', 'external')).toEqual({
    tabId: 'tab',
    paneKey,
    ptyId: null
  })
  state.tabsByWorktree.wt = []
  expect(findCursorTranscriptTerminal(state, 'wt', 'external')).toBeNull()
})

it('does not attach a reader to a leaf that was removed from a surviving split', () => {
  const state = fixture()
  state.terminalLayoutsByTabId.tab.root = { type: 'leaf', leafId: 'replacement' }
  expect(findCursorTranscriptTerminal(state, 'wt', 'external')).toBeNull()
})

it('does not borrow a previous session while a live replacement has no provider identity', () => {
  const state = fixture()
  const { providerSession: _providerSession, ...withoutIdentity } = liveCursor
  state.agentStatusByPaneKey = live(withoutIdentity)
  expect(findCursorTranscriptTerminal(state, 'wt', 'external')).toBeNull()
})
