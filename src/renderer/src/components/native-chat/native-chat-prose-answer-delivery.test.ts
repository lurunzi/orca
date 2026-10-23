import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendRuntimePtyInput = vi.fn()
const sendRuntimePtyInputVerified = vi.fn()
vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  sendRuntimePtyInput: (...args: unknown[]) => sendRuntimePtyInput(...args)
}))
vi.mock('@/runtime/runtime-terminal-verified-input', () => ({
  sendRuntimePtyInputVerified: (...args: unknown[]) => sendRuntimePtyInputVerified(...args)
}))
import {
  resetNativeChatPtySendQueuesForTests,
  sendNativeChatMessage
} from './native-chat-runtime-send'
import { buildNativeChatPasteBytes, NATIVE_CHAT_SUBMIT } from './native-chat-send'
import {
  NATIVE_CHAT_SUBMIT_CONFIRM_MS,
  NATIVE_CHAT_SUBMIT_RETRY_MAX
} from './native-chat-submit-confirmation'

const onDeliverySettled = vi.fn()
const composerHoldsDraft = vi.fn()
const submitDelayMs = 800
function send() {
  return sendNativeChatMessage('pty-prose', 'tools', {
    onDeliverySettled,
    submitConfirmation: { submitDelayMs, composerHoldsDraft }
  })
}
const writes = () => sendRuntimePtyInputVerified.mock.calls.map((call) => call[1])

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  resetNativeChatPtySendQueuesForTests()
  sendRuntimePtyInputVerified.mockReset().mockResolvedValue(true)
  composerHoldsDraft.mockReset().mockReturnValue(true)
})
afterEach(() => {
  resetNativeChatPtySendQueuesForTests()
  vi.useRealTimers()
})

describe('acknowledged Antigravity prose answer delivery', () => {
  it('honours paste settling, retries only Enter, and reports success after the draft leaves', async () => {
    send()
    await vi.advanceTimersByTimeAsync(submitDelayMs - 1)
    expect(writes()).toEqual([buildNativeChatPasteBytes('tools')])
    await vi.advanceTimersByTimeAsync(1)
    expect(writes()).toEqual([buildNativeChatPasteBytes('tools'), NATIVE_CHAT_SUBMIT])
    expect(onDeliverySettled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(NATIVE_CHAT_SUBMIT_CONFIRM_MS)
    expect(writes()).toEqual([
      buildNativeChatPasteBytes('tools'),
      NATIVE_CHAT_SUBMIT,
      NATIVE_CHAT_SUBMIT
    ])
    expect(sendRuntimePtyInputVerified).toHaveBeenLastCalledWith(
      'pty-prose',
      NATIVE_CHAT_SUBMIT,
      'driving',
      { requireWriteSettlement: true }
    )
    composerHoldsDraft.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(NATIVE_CHAT_SUBMIT_CONFIRM_MS)
    expect(onDeliverySettled).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('leaves the card actionable if the composer still holds the draft after bounded retries', async () => {
    send()
    await vi.runAllTimersAsync()
    expect(writes().filter((data) => data === NATIVE_CHAT_SUBMIT)).toHaveLength(
      1 + NATIVE_CHAT_SUBMIT_RETRY_MAX
    )
    expect(onDeliverySettled).toHaveBeenCalledExactlyOnceWith(false)
  })

  it.each(['refused', 'unknown'] as const)(
    'keeps a %s retry unconfirmed without replaying the answer body',
    async (outcome) => {
      send()
      await vi.advanceTimersByTimeAsync(submitDelayMs)
      if (outcome === 'refused') {
        sendRuntimePtyInputVerified.mockResolvedValueOnce(false)
      } else {
        sendRuntimePtyInputVerified.mockRejectedValueOnce(new Error('acknowledgment lost'))
      }
      await vi.runAllTimersAsync()
      expect(writes()).toEqual([
        buildNativeChatPasteBytes('tools'),
        NATIVE_CHAT_SUBMIT,
        NATIVE_CHAT_SUBMIT
      ])
      expect(onDeliverySettled).toHaveBeenCalledExactlyOnceWith(false)
    }
  )

  it('does not press Enter when the body was refused', async () => {
    sendRuntimePtyInputVerified.mockResolvedValueOnce(false)
    send()
    await vi.runAllTimersAsync()
    expect(writes()).toEqual([buildNativeChatPasteBytes('tools')])
    expect(onDeliverySettled).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('stops retries on cancellation after Enter without clearing potentially submitted input', async () => {
    const handle = send()
    await vi.advanceTimersByTimeAsync(submitDelayMs)
    sendRuntimePtyInput.mockClear()
    handle.cancel()
    await vi.runAllTimersAsync()
    expect(writes()).toEqual([buildNativeChatPasteBytes('tools'), NATIVE_CHAT_SUBMIT])
    expect(sendRuntimePtyInput).not.toHaveBeenCalled()
    expect(onDeliverySettled).not.toHaveBeenCalled()
  })

  it('does not retry blind after the terminal reader fails', async () => {
    composerHoldsDraft.mockImplementation(() => {
      throw new Error('disconnected')
    })
    send()
    await vi.runAllTimersAsync()
    expect(writes()).toEqual([buildNativeChatPasteBytes('tools'), NATIVE_CHAT_SUBMIT])
    expect(onDeliverySettled).toHaveBeenCalledExactlyOnceWith(false)
  })
})
