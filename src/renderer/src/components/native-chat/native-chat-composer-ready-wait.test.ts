import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendRuntimePtyInput = vi.fn()
vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  sendRuntimePtyInput: (...args: unknown[]) => sendRuntimePtyInput(...args)
}))
vi.mock('@/runtime/runtime-terminal-verified-input', () => ({
  sendRuntimePtyInputVerified: vi.fn()
}))

import {
  NATIVE_CHAT_SUBMIT_DELAY_MS,
  resetNativeChatPtySendQueuesForTests,
  sendNativeChatMessage
} from './native-chat-runtime-send'
import {
  NATIVE_CHAT_COMPOSER_READY_POLL_MS,
  NATIVE_CHAT_COMPOSER_READY_TIMEOUT_MS
} from './native-chat-composer-ready-wait'
import { NATIVE_CHAT_CLEAR_CONFIRM_MS } from './native-chat-input-clear'
import {
  buildNativeChatPasteBytes,
  NATIVE_CHAT_SUBMIT
} from '../../../../shared/native-chat/input/native-chat-paste-bytes'
import { buildAgentTuiClearInputForText } from '../../../../shared/agent-launch/startup/agent-tui-input-clear'

const PTY = 'pty-composer-ready'
const DRAFT = 'Linked Linear issue: ABC-123\nhttps://linear.app/x/issue/ABC-123'

const writes = (): string[] => sendRuntimePtyInput.mock.calls.map((call) => String(call[1]))

beforeEach(() => {
  vi.useFakeTimers()
  sendRuntimePtyInput.mockClear()
  sendRuntimePtyInput.mockReturnValue(true)
  resetNativeChatPtySendQueuesForTests()
})
afterEach(() => {
  vi.useRealTimers()
  resetNativeChatPtySendQueuesForTests()
})

describe('sendNativeChatMessage before the agent paints its composer', () => {
  it('touches nothing until the composer is painted, then sends in order', () => {
    const clearInput = buildAgentTuiClearInputForText(DRAFT)
    let painted = false
    sendNativeChatMessage(PTY, 'edited', {
      clearInput,
      confirmCleared: () => true,
      composerReady: () => painted
    })
    vi.advanceTimersByTime(NATIVE_CHAT_COMPOSER_READY_POLL_MS * 30)
    expect(writes()).toEqual([])

    painted = true
    vi.advanceTimersByTime(NATIVE_CHAT_COMPOSER_READY_POLL_MS)
    expect(writes()).toEqual([clearInput])
    vi.advanceTimersByTime(NATIVE_CHAT_CLEAR_CONFIRM_MS + NATIVE_CHAT_SUBMIT_DELAY_MS)
    expect(writes()).toEqual([clearInput, buildNativeChatPasteBytes('edited'), NATIVE_CHAT_SUBMIT])
  })

  it('holds a queued send behind the waiting one', async () => {
    let painted = false
    sendNativeChatMessage(PTY, 'first', {
      clearInput: '\x15',
      composerReady: () => painted
    })
    sendNativeChatMessage(PTY, 'second')
    await vi.advanceTimersByTimeAsync(NATIVE_CHAT_COMPOSER_READY_POLL_MS * 30)
    expect(writes()).toEqual([])

    painted = true
    await vi.advanceTimersByTimeAsync(
      NATIVE_CHAT_COMPOSER_READY_POLL_MS + NATIVE_CHAT_SUBMIT_DELAY_MS * 2
    )
    expect(writes().slice(0, 3)).toEqual([
      '\x15',
      buildNativeChatPasteBytes('first'),
      NATIVE_CHAT_SUBMIT
    ])
    expect(writes()).toContain(buildNativeChatPasteBytes('second'))
  })

  it('falls back to the best-effort send after the bound', () => {
    sendNativeChatMessage(PTY, 'edited', {
      clearInput: '\x15',
      composerReady: () => false
    })
    vi.advanceTimersByTime(NATIVE_CHAT_COMPOSER_READY_TIMEOUT_MS)
    expect(writes()).toEqual(['\x15', buildNativeChatPasteBytes('edited')])
  })

  it('leaves the parked draft alone when cancelled while waiting', () => {
    const handle = sendNativeChatMessage(PTY, 'edited', {
      clearInput: buildAgentTuiClearInputForText(DRAFT),
      composerReady: () => false
    })
    vi.advanceTimersByTime(NATIVE_CHAT_COMPOSER_READY_POLL_MS * 5)
    handle.cancel()
    vi.advanceTimersByTime(NATIVE_CHAT_COMPOSER_READY_TIMEOUT_MS)
    expect(writes()).toEqual([])
  })
})
