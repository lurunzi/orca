// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react'
import type {
  AgentStatusEntry,
  AgentStatusPayload
} from '../../../../../../shared/agent-status/contracts/agent-status-types'
import type { NativeChatMessage } from '../../../../../../shared/native-chat/native-chat-types'
import type { NativeChatLiveSession } from '../../session/terminal/read/native-chat-live-session-contract'

// Stub transcript/composer to exercise store status through the view into shared turn and prompt rendering.
const retained = vi.hoisted((): { session: NativeChatLiveSession | null } => ({ session: null }))
vi.mock('../../session/terminal/read/use-native-chat-retained-session', () => ({
  useNativeChatRetainedSession: () => retained.session
}))
vi.mock('../../composer/NativeChatComposer', () => ({ NativeChatComposer: () => null }))

const { NativeChatResolvedView } = await import('../../NativeChatResolvedView')
const { TooltipProvider } = await import('@/components/ui/tooltip')
const { useAppStore } = await import('../../../../store/index')
const { acceptedAgentStatuses } =
  await import('../../../../store/slices/agent-status/status-ownership/accepted-agent-statuses')
const { installNativeChatMessageListTestViewport } =
  await import('../../viewport/virtualization/native-chat-message-list-test-viewport')

const paneKey = 'tab-state:leaf-state'
let restoreViewport = (): void => {}

const userTurn: NativeChatMessage = {
  id: 'user-1',
  role: 'user',
  blocks: [{ type: 'text', text: 'Rename the module' }],
  timestamp: 1,
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
  patchStatus({ stateStartedAt: NOW - age })
}

function patchStatus(fields: Partial<AgentStatusEntry>): void {
  const live = useAppStore.getState().agentStatusByPaneKey.get(paneKey)
  if (!live) {
    throw new Error('the store dropped the status row this test depends on')
  }
  useAppStore.setState((store) => ({
    agentStatusByPaneKey: store.agentStatusByPaneKey.replace([[paneKey, { ...live, ...fields }]])
  }))
}

function renderPane(
  onSwitchToTerminal: () => void,
  agent: 'claude' | 'antigravity',
  readTerminalScreen: (format?: 'text') => string | null
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

// Status ages are measured from a fixed clock; only Date is faked so React timers stay real.
const NOW = Date.UTC(2026, 0, 1)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  restoreViewport = installNativeChatMessageListTestViewport()
  useAppStore.setState({
    agentStatusByPaneKey: acceptedAgentStatuses(),
    nativeChatLaunchPromptByTabId: {}
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  restoreViewport()
  useAppStore.setState({
    agentStatusByPaneKey: acceptedAgentStatuses(),
    nativeChatLaunchPromptByTabId: {}
  })
})

// Fork: an Antigravity prose question is answered in chat, not through the terminal preview.
describe('NativeChatResolvedView Antigravity prose question', () => {
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
    expect(screen.queryByRole('button', { name: /Continue in terminal/ })).toBeNull()
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
      fireEvent.click(screen.getByRole('button', { name: /Continue in terminal/ }))
      expect(openTerminal).toHaveBeenCalledOnce()
      fireEvent.click(screen.getByRole('button', { name: 'Awaiting user input' }))
      expect(screen.queryByText('Report ready: investigation.md')).toBeNull()
      readScreen.mockReturnValue(null)
      fireEvent.click(screen.getByRole('button', { name: 'Awaiting user input' }))
      expect(readScreen).toHaveBeenCalledTimes(2)
      expect(screen.queryByText('Report ready: investigation.md')).toBeNull()
      expect(screen.getByRole('button', { name: /Continue in terminal/ })).toBeVisible()
      expect(document.querySelector('[data-native-chat-turn-activity]')).toBeNull()
      act(() => {
        retained.session = { ...retained.session!, hookAwaitingInput: false }
        patchStatus({ state: 'done' })
      })
      view.unmount()
      renderPane(openTerminal, 'antigravity', readScreen)
      expect(screen.queryByRole('button', { name: /Continue in terminal/ })).toBeNull()
      expect(screen.queryByText('Awaiting user input')).toBeNull()
    }
  )
})
