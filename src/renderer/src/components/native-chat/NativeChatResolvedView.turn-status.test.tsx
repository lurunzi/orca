// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react'
import type {
  AgentStatusEntry,
  AgentStatusPayload
} from '../../../../shared/agent-status/contracts/agent-status-types'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import type { NativeChatLiveSession } from './use-native-chat-live-session'

// Stub transcript/composer to exercise store status through the view into shared turn and prompt rendering.
const retained = vi.hoisted((): { session: NativeChatLiveSession | null } => ({ session: null }))
vi.mock('./use-native-chat-retained-session', () => ({
  useNativeChatRetainedSession: () => retained.session
}))
vi.mock('./NativeChatComposer', () => ({ NativeChatComposer: () => null }))

const { NativeChatResolvedView } = await import('./NativeChatResolvedView')
const { TooltipProvider } = await import('@/components/ui/tooltip')
const { useAppStore } = await import('../../store')
const { installNativeChatMessageListTestViewport } =
  await import('./native-chat-message-list-test-viewport')

const paneKey = 'tab-state:leaf-state'
let restoreViewport = (): void => {}

const userTurn: NativeChatMessage = {
  id: 'user-1',
  role: 'user',
  blocks: [{ type: 'text', text: 'Rename the module' }],
  timestamp: 1,
  source: 'transcript'
}

const stepCall: NativeChatMessage = {
  id: 'step-1',
  role: 'assistant',
  blocks: [{ type: 'tool-call', name: 'Bash', input: { command: 'pnpm build' } }],
  timestamp: 3,
  source: 'transcript'
}

// State both reconciled fields so the fixture represents a consistent live session.
function transcript(
  status: NativeChatLiveSession['status'],
  hookAwaitingInput: boolean,
  messages: NativeChatMessage[] = [userTurn]
): NativeChatLiveSession {
  return {
    messages,
    status,
    sessionId: 'session-state',
    agent: 'claude',
    hookAwaitingInput,
    hasMore: false,
    loadingEarlier: false,
    olderHistoryGeneration: 0,
    loadEarlier: vi.fn(),
    readPhase: 'ready'
  }
}

function setStatus(payload: Omit<AgentStatusPayload, 'prompt' | 'agentType'>, age = 0): void {
  useAppStore
    .getState()
    .setAgentStatus(paneKey, { prompt: 'Rename the module', agentType: 'claude', ...payload })
  const live = useAppStore.getState().agentStatusByPaneKey[paneKey]
  if (!live) {
    throw new Error('the store dropped the status row this test depends on')
  }
  useAppStore.setState((store) => ({
    agentStatusByPaneKey: {
      ...store.agentStatusByPaneKey,
      [paneKey]: { ...live, stateStartedAt: Date.now() - age }
    }
  }))
}

function patchStatus(fields: Partial<AgentStatusEntry>): void {
  useAppStore.setState((store) => ({
    agentStatusByPaneKey: {
      ...store.agentStatusByPaneKey,
      [paneKey]: { ...store.agentStatusByPaneKey[paneKey]!, ...fields }
    }
  }))
}

function renderPane(
  onSwitchToTerminal?: () => void,
  agent: 'claude' | 'antigravity' = 'claude',
  readTerminalScreen?: (format?: 'text') => string | null
): RenderResult {
  return render(
    <TooltipProvider>
      <NativeChatResolvedView
        paneKey={paneKey}
        agent={agent}
        sessionId="session-state"
        transcriptPath={null}
        isVisible
        isFocusedGroup={false}
        targetPtyId="pty-state"
        terminalTabId="tab-state"
        ownsTabWideLaunchDraft={false}
        onSwitchToTerminal={onSwitchToTerminal}
        readTerminalScreen={readTerminalScreen}
      />
    </TooltipProvider>
  )
}

function liveActivityLine(): Element | null {
  return document.querySelector('[data-native-chat-turn-activity]')
}

beforeEach(() => {
  restoreViewport = installNativeChatMessageListTestViewport()
  useAppStore.setState({ agentStatusByPaneKey: {}, nativeChatLaunchPromptByTabId: {} })
})

afterEach(() => {
  cleanup()
  restoreViewport()
  useAppStore.setState({ agentStatusByPaneKey: {}, nativeChatLaunchPromptByTabId: {} })
})

describe('NativeChatResolvedView turn status', () => {
  it('replaces the terminal-preview fallback with an answerable Antigravity prose question', () => {
    const question = '请告诉我脚本放在哪个仓库。'
    retained.session = {
      ...transcript('ready', true, [
        userTurn,
        {
          id: 'prose-question',
          role: 'assistant',
          timestamp: 2,
          source: 'transcript',
          blocks: [
            {
              type: 'text',
              text: `| 方案 | 说明 |\n| --- | --- |\n| 离线整包 | 固定版本 |\n\n${question}`
            }
          ]
        }
      ]),
      agent: 'antigravity'
    }
    setStatus({ state: 'waiting' })
    patchStatus({ agentType: 'antigravity' })
    const readScreen = vi.fn(() => 'terminal preview')
    renderPane(vi.fn(), 'antigravity', readScreen)
    expect(screen.getByRole('group', { name: question })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type your answer')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Awaiting user input' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Continue with Terminal Agent/ })).toBeNull()
    expect(readScreen).not.toHaveBeenCalled()
  })

  it.each(['waiting', 'blocked'] as const)(
    'opens the owning terminal for an unshown %s interaction',
    (state) => {
      retained.session = {
        ...transcript('ready', true, [
          userTurn,
          {
            id: 'report',
            role: 'assistant',
            blocks: [{ type: 'text', text: 'The report is saved.' }],
            timestamp: 2,
            source: 'transcript'
          }
        ]),
        agent: 'antigravity'
      }
      setStatus({ state }, 20_000)
      patchStatus({ agentType: 'antigravity' })
      const openTerminal = vi.fn()
      const readScreen = vi.fn((): string | null => 'Report ready: investigation.md')
      const view = renderPane(openTerminal, 'antigravity', readScreen)
      expect(readScreen).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Awaiting user input' }))
      expect(readScreen).toHaveBeenCalledWith('text')
      expect(screen.getByText('Report ready: investigation.md')).toBeInTheDocument()
      expect(screen.getByText('The report is saved.')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Continue with Terminal Agent/ }))
      expect(openTerminal).toHaveBeenCalledOnce()
      fireEvent.click(screen.getByRole('button', { name: 'Awaiting user input' }))
      expect(screen.queryByText('Report ready: investigation.md')).toBeNull()
      readScreen.mockReturnValue(null)
      fireEvent.click(screen.getByRole('button', { name: 'Awaiting user input' }))
      expect(readScreen).toHaveBeenCalledTimes(2)
      expect(screen.queryByText('Report ready: investigation.md')).toBeNull()
      expect(screen.getByRole('button', { name: /Continue with Terminal Agent/ })).toBeVisible()
      expect(liveActivityLine()).toBeNull()
      act(() => {
        retained.session = { ...retained.session!, hookAwaitingInput: false }
        patchStatus({ state: 'done' })
      })
      view.unmount()
      renderPane(openTerminal, 'antigravity', readScreen)
      expect(screen.queryByRole('button', { name: /Continue with Terminal Agent/ })).toBeNull()
      expect(screen.queryByText('Awaiting user input')).toBeNull()
    }
  )

  // Store staleness alone cannot prove an unanswered turn ended.
  it('does not settle a turn the host went quiet on', () => {
    retained.session = transcript('ready', true, [userTurn, stepCall])
    setStatus({ state: 'waiting' }, 60_000)
    patchStatus({ turnStartedAt: Date.now() - 60_000 })

    renderPane()
    expect(screen.getByText('Working for 1m 0s')).toBeInTheDocument()

    // The live session reads no hook state once the row is stale, so the wait no longer holds the turn.
    retained.session = transcript('ready', false, [userTurn, stepCall])
    act(() => {
      patchStatus({ updatedAt: Date.now() - 31 * 60_000 })
    })

    expect(screen.queryByText(/Work(ing|ed) for/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Toggle turn details' })).toBeNull()
    expect(screen.getByText('pnpm build')).toBeInTheDocument()
  })

  it('folds finished turns from history behind their transcript duration', () => {
    const at = Date.parse('2026-09-28T10:00:00.000Z')
    retained.session = transcript('ready', false, [
      { ...userTurn, timestamp: at },
      {
        id: 'answer-1',
        role: 'assistant',
        blocks: [{ type: 'text', text: 'Renamed.' }],
        timestamp: at + 45_000,
        source: 'transcript'
      },
      {
        id: 'user-2',
        role: 'user',
        blocks: [{ type: 'text', text: 'Now add tests' }],
        timestamp: at + 100_000,
        source: 'transcript'
      }
    ])
    setStatus({ state: 'done' }, 60_000)

    renderPane()

    expect(screen.getByText('Worked for 45s')).toBeInTheDocument()
    // The latest turn has no recorded end, and this pane never watched it.
    expect(screen.getAllByText(/Work(ing|ed) for/)).toHaveLength(1)
  })
})
