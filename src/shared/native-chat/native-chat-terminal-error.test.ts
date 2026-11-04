import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../agent-status-types'
import type { NativeChatMessage } from './native-chat-types'
import {
  nativeChatTerminalErrorText,
  withNativeChatTerminalError
} from './native-chat-terminal-error'

const TEXT =
  'Individual quota reached. Resets in 4h56m48s.\nErrID: 00000000-0000-4000-8000-000000000001-10'
const status = {
  agentType: 'antigravity',
  state: 'done',
  paneKey: 'pane',
  prompt: '',
  stateStartedAt: 20,
  updatedAt: 20,
  stateHistory: [],
  mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: 20 },
  lastAssistantMessage: TEXT,
  lastAssistantMessageIsToolOutput: true,
  providerSession: { key: 'conversation_id', id: 'session' }
} satisfies AgentStatusEntry
const prompt: NativeChatMessage = {
  id: 'user',
  role: 'user',
  blocks: [{ type: 'text', text: 'go' }],
  timestamp: 1,
  source: 'transcript'
}

describe('terminal failures in native chat', () => {
  it('projects a host-reported native failure as an inline error without losing history', () => {
    const text = nativeChatTerminalErrorText(status, 'antigravity', 'session')
    expect(text).toBe(TEXT)
    expect(withNativeChatTerminalError([prompt], text, 20)).toEqual([
      prompt,
      {
        id: 'terminal-error:20',
        role: 'system',
        blocks: [{ type: 'text', text: TEXT, tone: 'error' }],
        timestamp: 20,
        source: 'hook'
      }
    ])
  })

  it('isolates other agents and sessions', () => {
    expect(nativeChatTerminalErrorText(status, 'claude', 'session')).toBeNull()
    expect(nativeChatTerminalErrorText(status, 'antigravity', 'other-session')).toBeNull()
    expect(
      nativeChatTerminalErrorText({ ...status, sessionBoundary: true }, 'antigravity', 'session')
    ).toBeNull()
  })

  it('ignores arbitrary tool failures and clears on a newer turn', () => {
    expect(
      nativeChatTerminalErrorText(
        { ...status, lastAssistantMessage: 'tool failed' },
        'antigravity',
        'session'
      )
    ).toBeNull()
    expect(
      nativeChatTerminalErrorText(
        { ...status, mainAgent: { state: 'working', stateStartedAt: 30 } },
        'antigravity',
        'session'
      )
    ).toBeNull()
    const messages = [prompt, { ...prompt, id: 'new', timestamp: 30 }]
    expect(withNativeChatTerminalError(messages, TEXT, 20)).toBe(messages)
  })
})
