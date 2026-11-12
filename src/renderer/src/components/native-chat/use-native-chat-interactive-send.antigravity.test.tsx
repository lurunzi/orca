// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  inferQuestionAnswered: vi.fn(() => Promise.resolve(true)),
  sendRuntimePtyInput: vi.fn(),
  sendRuntimePtyInputVerified: vi.fn((..._args: unknown[]) => Promise.resolve(true)),
  sendNativeChatAskAnswer: vi.fn(),
  sendNativeChatMessage: vi.fn(),
  storeState: { agentStatusByPaneKey: {} as Record<string, unknown> }
}))

const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'
const waitingQuestion = {
  state: 'waiting' as const,
  prompt: 'pick one',
  updatedAt: Date.now(),
  stateStartedAt: Date.now(),
  agentType: 'claude' as const,
  paneKey: PANE_KEY,
  stateHistory: [],
  toolName: 'AskUserQuestion'
}

vi.mock('../../store', () => ({
  useAppStore: {
    getState: () => mocks.storeState
  }
}))

vi.mock('@/runtime/hosted-terminals/input/runtime-terminal-input-send', () => ({
  sendRuntimePtyInput: (...args: unknown[]) => mocks.sendRuntimePtyInput(...args)
}))
vi.mock('@/runtime/hosted-terminals/input/runtime-terminal-verified-input', () => ({
  sendRuntimePtyInputVerified: (...args: unknown[]) => mocks.sendRuntimePtyInputVerified(...args)
}))

vi.mock('./session/terminal/send/native-chat-runtime-send', () => ({
  sendNativeChatAskAnswer: (...args: unknown[]) => mocks.sendNativeChatAskAnswer(...args),
  sendNativeChatMessage: (...args: unknown[]) => mocks.sendNativeChatMessage(...args)
}))

import { useNativeChatInteractiveSend } from './session/terminal/send/use-native-chat-interactive-send'
import type { AskPrompt } from '../../../../shared/native-chat/input/native-chat-ask-types'

const PROMPT: AskPrompt = {
  questions: [{ question: 'q', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] }]
}

describe('useNativeChatInteractiveSend prose and Antigravity answers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.storeState = { agentStatusByPaneKey: { [PANE_KEY]: waitingQuestion } }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { agentStatus: { inferQuestionAnswered: mocks.inferQuestionAnswered } }
    })
    const handle = { cancel: mocks.cancel, settleAfterMs: 500 }
    mocks.sendNativeChatAskAnswer.mockReturnValue(handle)
    mocks.sendNativeChatMessage.mockReturnValue(handle)
  })

  it('explicit prose delivery bypasses selector keys and question-state inference', () => {
    const { result } = renderHook(() => useNativeChatInteractiveSend(PANE_KEY, 'pty-1', 'codex'))
    act(() =>
      result.current.sendAnswer(PROMPT, [{ indices: [], other: 'tools' }], undefined, 'message')
    )
    expect(mocks.sendNativeChatMessage).toHaveBeenCalledWith('pty-1', 'tools', {
      onDeliverySettled: expect.any(Function)
    })
    mocks.sendNativeChatMessage.mock.calls[0]?.[2]?.onDeliverySettled(true)
    expect(mocks.sendNativeChatAskAnswer).not.toHaveBeenCalled()
    expect(mocks.inferQuestionAnswered).not.toHaveBeenCalled()
  })

  it('confirms Antigravity prose replies through the existing composer reader', () => {
    const readScreen = vi.fn(() => '')
    const onSettled = vi.fn()
    const { result } = renderHook(() =>
      useNativeChatInteractiveSend(PANE_KEY, 'pty-1', 'antigravity', readScreen)
    )
    act(() =>
      result.current.sendAnswer(PROMPT, [{ indices: [], other: 'tools' }], onSettled, 'message')
    )
    const options = mocks.sendNativeChatMessage.mock.calls[0]?.[2]
    expect(options.submitConfirmation).toEqual({
      submitDelayMs: expect.any(Number),
      composerHoldsDraft: expect.any(Function)
    })
    options.submitConfirmation.composerHoldsDraft()
    expect(readScreen).toHaveBeenCalledOnce()
    expect(onSettled).not.toHaveBeenCalled()
    options.onDeliverySettled(false)
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(false)
    expect(mocks.sendNativeChatAskAnswer).not.toHaveBeenCalled()
  })

  it('navigates Antigravity to the selected row before submitting', () => {
    const { result } = renderHook(() =>
      useNativeChatInteractiveSend(PANE_KEY, 'pty-1', 'antigravity')
    )
    act(() => result.current.sendAnswer(PROMPT, [{ indices: [1] }]))
    expect(mocks.sendNativeChatAskAnswer).toHaveBeenCalledWith(
      'pty-1',
      [{ raw: '\x1b[B' }, { raw: '\r' }],
      expect.any(Function)
    )
    expect(mocks.sendNativeChatMessage).not.toHaveBeenCalled()
  })
})
