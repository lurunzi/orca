// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../../shared/agent-session-journal-types'
import { agentJournalSubmissionKey } from '../../../../shared/agent-session-journal-item-key'
import { structuredAgentSessionSendBody } from '../../../../shared/structured-agent-session-send-mutation'
import { projectStructuredAgentSessionMessages } from './structured-agent-session-message-projection'
import { nativeChatPromptDismissals } from './native-chat-prompt-dismissals'
import { NativeChatStructuredAsyncQuestion } from './NativeChatStructuredAsyncQuestion'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.useFakeTimers()
  nativeChatPromptDismissals.clearForTests()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

const asked: NativeChatMessage = {
  id: 'ask',
  role: 'assistant',
  blocks: [
    { type: 'text', text: 'Which color?\n- Red\n- Blue' },
    {
      type: 'tool-call',
      name: 'request_user_input_async',
      input: { questions: [{ title: 'Which color?', options: ['Red', 'Blue'] }] }
    }
  ],
  timestamp: null,
  source: 'transcript'
}

describe('NativeChatStructuredAsyncQuestion', () => {
  it('answers a Codex async question with an ordinary send, then hides it', () => {
    const send = vi.fn(() => true)
    act(() =>
      root.render(
        <NativeChatStructuredAsyncQuestion
          paneKey="tab-1:structured"
          session={{ messages: [asked], readPhase: 'ready' }}
          send={send}
        />
      )
    )
    const blue = [...container.querySelectorAll('button[aria-pressed]')].find((node) =>
      node.textContent?.includes('Blue')
    )
    act(() => blue?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    act(() => vi.runAllTimers())

    expect(send).toHaveBeenCalledWith('> Which color?\n\nBlue', [])
    expect(container.textContent).not.toContain('Which color?')
  })

  it('keeps an answered card hidden through the optimistic-to-held send handoff', () => {
    const send = vi.fn(() => true)
    const askItem: AgentJournalRenderItem = {
      itemId: 'ask',
      revision: 1,
      sequence: 1,
      observedAt: 1,
      body: { kind: 'message', role: 'assistant', blocks: asked.blocks }
    }
    const answer = {
      clientMessageId: 'answer',
      body: structuredAgentSessionSendBody('> Which color?\n\nBlue', []),
      queuedAt: 2
    }
    const answerItem: AgentJournalRenderItem = {
      itemId: agentJournalSubmissionKey(answer.clientMessageId),
      revision: 1,
      sequence: 2,
      observedAt: 2,
      body: answer.body
    }
    const held: AgentJournalSubmission = {
      clientMessageId: answer.clientMessageId,
      fence: 1,
      payloadFingerprint: 'answer',
      dispatchState: 'pending',
      providerItemId: null,
      reason: null,
      submittedAt: 2,
      resolvedAt: null,
      handoverRecorded: true
    }
    const render = (messages: NativeChatMessage[]): void => {
      act(() =>
        root.render(
          <NativeChatStructuredAsyncQuestion
            paneKey="tab-1:structured"
            session={{ messages, readPhase: 'ready' }}
            send={send}
          />
        )
      )
    }
    const chooseBlue = (): void => {
      const blue = [...container.querySelectorAll('button[aria-pressed]')].find((node) =>
        node.textContent?.includes('Blue')
      )
      expect(blue).toBeDefined()
      act(() => blue?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      act(() => vi.runAllTimers())
    }

    render(projectStructuredAgentSessionMessages([askItem], [], []))
    chooseBlue()
    expect(send).toHaveBeenCalledExactlyOnceWith('> Which color?\n\nBlue', [])
    expect(container.textContent).not.toContain('Which color?')

    render(projectStructuredAgentSessionMessages([askItem], [answer], []))
    expect(container.textContent).not.toContain('Which color?')
    render(projectStructuredAgentSessionMessages([askItem, answerItem], [], [held]))
    expect(container.querySelector('button[aria-pressed]')).toBeNull()
    expect(container.textContent).not.toContain('Which color?')
    expect(send).toHaveBeenCalledTimes(1)

    const accepted: AgentJournalSubmission = {
      ...held,
      dispatchState: 'accepted',
      handedOverAt: 3,
      resolvedAt: 3
    }
    render(projectStructuredAgentSessionMessages([askItem, answerItem], [], [accepted]))
    expect(container.textContent).not.toContain('Which color?')
    render(
      projectStructuredAgentSessionMessages(
        [askItem, answerItem, { ...askItem, itemId: 'ask-again', sequence: 3, observedAt: 4 }],
        [],
        [accepted]
      )
    )
    chooseBlue()
    expect(send).toHaveBeenCalledTimes(2)
  })
})
