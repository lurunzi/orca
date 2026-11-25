import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendRuntimePtyInput = vi.fn()
vi.mock('@/runtime/hosted-terminals/input/runtime-terminal-input-send', () => ({
  sendRuntimePtyInput: (...args: unknown[]) => sendRuntimePtyInput(...args)
}))
vi.mock('@/runtime/hosted-terminals/input/runtime-terminal-verified-input', () => ({
  sendRuntimePtyInputVerified: async (...args: unknown[]) => sendRuntimePtyInput(...args)
}))

import { sendNativeChatMessage } from './session/terminal/send/native-chat-runtime-send'
import { NATIVE_CHAT_SUBMIT_DELAY_MS } from '../../../../shared/native-chat/input/questions/native-chat-answer-stepping'
import { cancelNativeChatPtySends } from './session/terminal/send/native-chat-pty-send-queue'
import {
  NATIVE_CHAT_COMPOSER_READY_POLL_MS,
  NATIVE_CHAT_COMPOSER_READY_TIMEOUT_MS
} from './native-chat-composer-ready-wait'
import { NATIVE_CHAT_CLEAR_CONFIRM_MS } from './session/terminal/send/native-chat-input-clear'
import {
  buildNativeChatPasteBytes,
  NATIVE_CHAT_SUBMIT
} from '../../../../shared/native-chat/input/composer/native-chat-paste-bytes'
import { buildAgentTuiClearInputForText } from '../../../../shared/agent-launch/startup/agent-tui-input-clear'

const PTY = 'pty-composer-ready'
const DRAFT = 'Linked Linear issue: ABC-123\nhttps://linear.app/x/issue/ABC-123'

const writes = (): string[] => sendRuntimePtyInput.mock.calls.map((call) => String(call[1]))

beforeEach(() => {
  vi.useFakeTimers()
  sendRuntimePtyInput.mockClear()
  sendRuntimePtyInput.mockReturnValue(true)
  cancelNativeChatPtySends(PTY)
})
afterEach(() => {
  vi.useRealTimers()
  cancelNativeChatPtySends(PTY)
})

describe('sendNativeChatMessage before the agent paints its composer', () => {
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
      NATIVE_CHAT_COMPOSER_READY_POLL_MS +
        NATIVE_CHAT_CLEAR_CONFIRM_MS +
        NATIVE_CHAT_SUBMIT_DELAY_MS * 2
    )
    expect(writes().slice(0, 3)).toEqual([
      '\x15',
      buildNativeChatPasteBytes('first'),
      NATIVE_CHAT_SUBMIT
    ])
    expect(writes()).toContain(buildNativeChatPasteBytes('second'))
  })

  it('falls back to the best-effort send after the bound', async () => {
    sendNativeChatMessage(PTY, 'edited', {
      clearInput: '\x15',
      composerReady: () => false
    })
    await vi.advanceTimersByTimeAsync(
      NATIVE_CHAT_COMPOSER_READY_TIMEOUT_MS + NATIVE_CHAT_CLEAR_CONFIRM_MS
    )
    expect(writes().slice(0, 2)).toEqual(['\x15', buildNativeChatPasteBytes('edited')])
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
