// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AgentSessionContinuationRequest } from '@/lib/agent-session-continuation'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'

const mocks = vi.hoisted(() => {
  const agentStatusByPaneKey: Record<string, Partial<AgentStatusEntry>> = {}
  const dialogRequests: AgentSessionContinuationRequest[] = []
  return { state: { agentStatusByPaneKey }, dialogRequests }
})

vi.mock('@/store', () => {
  const useAppStore = (selector: (state: object) => unknown) => selector(mocks.state)
  useAppStore.getState = () => mocks.state
  return { useAppStore }
})
vi.mock('@/components/tab-bar/tab-move-to-pane-column', () => ({
  canMoveTabToNewPaneColumnFromState: () => false,
  moveTabToNewPaneColumn: vi.fn()
}))
vi.mock('@/components/agent-session-continuation/AgentSessionContinuationDialog', () => ({
  AgentSessionContinuationDialog: ({ request }: { request: AgentSessionContinuationRequest }) => {
    mocks.dialogRequests.push(request)
    return <div role="dialog" />
  }
}))

import { StructuredAgentSessionHeaderActions } from './StructuredAgentSessionHeaderActions'
import { useStructuredChatContinuation } from './use-structured-chat-continuation'
import {
  prepareStructuredChatContinuation,
  structuredChatTranscriptText
} from './structured-chat-continuation-request'

const CONTINUE = 'Continue in New Session…'
const CONTEXT = { worktreeId: 'folder:ws-1', worktreePath: '/srv/ws', runtimeEnvironmentId: null }

function message(role: NativeChatMessage['role'], text: string): NativeChatMessage {
  return {
    id: `${role}-${text}`,
    role,
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  }
}

function Harness(props: {
  messages: NativeChatMessage[]
  fileLinkContext?: typeof CONTEXT | null
}): React.JSX.Element {
  const continuation = useStructuredChatContinuation({
    fileLinkContext: props.fileLinkContext === undefined ? CONTEXT : props.fileLinkContext,
    groupId: 'group-1',
    paneKey: 'tab-1:pane',
    agent: 'claude',
    messages: props.messages
  })
  return (
    <TooltipProvider>
      <StructuredAgentSessionHeaderActions
        tabId="tab-1"
        groupId="group-1"
        handoffStatus={null}
        isWorking={false}
        onHandoffRequest={vi.fn()}
        onContinueInNewSession={continuation.onContinue}
      />
      {continuation.dialog}
    </TooltipProvider>
  )
}

afterEach(() => {
  cleanup()
  mocks.state.agentStatusByPaneKey = {}
  mocks.dialogRequests.length = 0
})

describe('structured chat continuation', () => {
  it('opens the continuation dialog with the chat transcript', () => {
    render(<Harness messages={[message('user', 'fix the bug'), message('assistant', 'done')]} />)

    const button = screen.getByRole('button', { name: CONTINUE })
    expect(screen.getAllByRole('button')[0]).toBe(button)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(button)

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(mocks.dialogRequests.at(-1)).toMatchObject({
      source: {
        sourceAgent: 'claude',
        capturedText: 'user: fix the bug\n\nassistant: done',
        transcriptPath: null
      },
      worktreeId: 'folder:ws-1',
      groupId: 'group-1',
      workspacePath: '/srv/ws',
      initialCwd: '/srv/ws'
    })
  })

  it('hides the button without a workspace or any session content', () => {
    render(<Harness messages={[message('user', 'hi')]} fileLinkContext={null} />)
    expect(screen.queryByRole('button', { name: CONTINUE })).toBeNull()
    cleanup()

    render(<Harness messages={[message('assistant', '   ')]} />)
    expect(screen.queryByRole('button', { name: CONTINUE })).toBeNull()
  })

  it('offers continuation from the host transcript before any page loads', () => {
    mocks.state.agentStatusByPaneKey['tab-1:pane'] = {
      providerSession: { key: 'session_id', id: 's-1', transcriptPath: '/home/u/s-1.jsonl' },
      prompt: 'last ask',
      lastAssistantMessage: 'tool noise',
      lastAssistantMessageIsToolOutput: true
    }
    render(<Harness messages={[]} />)

    fireEvent.click(screen.getByRole('button', { name: CONTINUE }))

    expect(mocks.dialogRequests.at(-1)?.source).toMatchObject({
      capturedText: '',
      transcriptPath: '/home/u/s-1.jsonl',
      lastPrompt: 'last ask',
      lastAssistantMessage: null
    })
  })
})

describe('structuredChatTranscriptText', () => {
  it('skips harness-injected turns and non-text messages', () => {
    const toolOnly: NativeChatMessage = {
      ...message('assistant', 'x'),
      blocks: [{ type: 'tool-call', callId: 't', name: 'Bash', input: {} }]
    }
    expect(
      structuredChatTranscriptText([
        message('user', '<command-name>/clear</command-name>'),
        toolOnly,
        message('assistant', 'kept')
      ])
    ).toBe('assistant: kept')
  })

  it('returns null when nothing can be continued', () => {
    expect(
      prepareStructuredChatContinuation({
        agent: 'codex',
        messages: [],
        status: undefined,
        paneKey: 'p',
        worktreeId: 'w',
        workspacePath: '/w'
      })
    ).toBeNull()
  })
})
