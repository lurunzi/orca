import type { AppState } from '@/store/types'
import { parsePaneKey } from '../../../shared/stable-pane-id'

export type CursorTranscriptTerminal = { tabId: string; paneKey: string; ptyId: string | null }

export function findCursorTranscriptTerminal(
  state: Pick<
    AppState,
    | 'tabsByWorktree'
    | 'agentStatusByPaneKey'
    | 'sleepingAgentSessionsByPaneKey'
    | 'terminalLayoutsByTabId'
  >,
  worktreeId: string,
  sessionId: string
): CursorTranscriptTerminal | null {
  const tabs = state.tabsByWorktree[worktreeId] ?? []
  const keys = new Set([
    ...Object.keys(state.agentStatusByPaneKey),
    ...Object.keys(state.sleepingAgentSessionsByPaneKey)
  ])
  for (const paneKey of keys) {
    const pane = parsePaneKey(paneKey)
    const tab = pane && tabs.find((candidate) => candidate.id === pane.tabId)
    if (!pane || !tab) {
      continue
    }
    const live = state.agentStatusByPaneKey[paneKey]
    const retained = state.sleepingAgentSessionsByPaneKey[paneKey]
    const agent = live?.agentType ?? retained?.agent
    const provider = live?.providerSession ?? retained?.providerSession
    if (agent !== 'cursor' || provider?.id !== sessionId) {
      continue
    }
    const layout = state.terminalLayoutsByTabId[tab.id]
    return {
      tabId: tab.id,
      paneKey,
      ptyId: layout?.ptyIdsByLeafId?.[pane.leafId] ?? null
    }
  }
  return null
}
