// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendNativeChatMessageVerified = vi.fn()
const typeNativeChatCommand = vi.fn()
const switchCursorModel = vi.fn()

vi.mock('./cursor-model-switch', () => ({
  switchCursorModel: (...args: unknown[]) => switchCursorModel(...args)
}))

vi.mock('./native-chat-runtime-send', () => ({
  sendNativeChatMessageVerified: (...args: unknown[]) => sendNativeChatMessageVerified(...args),
  typeNativeChatCommand: (...args: unknown[]) => typeNativeChatCommand(...args)
}))
vi.mock('./native-chat-pty-send-queue', () => ({
  cancelNativeChatPtySends: vi.fn(),
  waitForNativeChatPtyIdle: vi.fn()
}))
vi.mock('@/lib/native-chat-telemetry', () => ({ emitNativeChatMessageSent: vi.fn() }))

import { useNativeChatSessionOptionCommand } from './use-native-chat-session-option-command'

describe('useNativeChatSessionOptionCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendNativeChatMessageVerified.mockResolvedValue(true)
    typeNativeChatCommand.mockResolvedValue(true)
  })

  it.each(['applied', 'unknown'] as const)(
    'returns the Cursor switch outcome (%s)',
    async (outcome) => {
      switchCursorModel.mockResolvedValue(outcome)
      const readTerminalScreen = () => 'Cursor Agent'
      const hook = renderHook(() =>
        useNativeChatSessionOptionCommand({
          agent: 'cursor',
          disabled: false,
          readTerminalScreen,
          resolveTarget: () => ({ settings: {}, ptyId: 'pty-1' })
        })
      )
      await act(async () => {
        expect(
          await hook.result.current.dispatch('/model grok-4.7-high', {
            detectAgentInteraction: 'cursor-model-picker',
            expectedChoiceLabel: 'Grok 4.7 High'
          })
        ).toEqual({ outcome })
      })
      expect(switchCursorModel).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'grok-4.7-high',
          modelLabel: 'Grok 4.7 High',
          readScreen: readTerminalScreen
        })
      )
      expect(sendNativeChatMessageVerified).not.toHaveBeenCalled()
      expect(typeNativeChatCommand).not.toHaveBeenCalled()
      expect(hook.result.current.isDispatching).toBe(false)
    }
  )
})
