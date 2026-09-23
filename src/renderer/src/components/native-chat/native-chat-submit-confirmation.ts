// Enter for native chat sends, optionally re-checked until the composer lets go
// of the draft. Split from native-chat-runtime-send.ts to keep that file bounded.

import { sendRuntimePtyInput } from '@/runtime/runtime-terminal-inspection'
import type { getSettingsForAgentTabRuntimeOwner } from '@/lib/agent-paste-draft'
import { NATIVE_CHAT_SUBMIT_DELAY_MS } from '../../../../shared/native-chat-answer-stepping'
import { NATIVE_CHAT_SUBMIT } from './native-chat-send'
import type { NativeChatSendOptions } from './native-chat-runtime-send'

type RuntimeSettings = ReturnType<typeof getSettingsForAgentTabRuntimeOwner>

export type NativeChatSubmitConfirmation = {
  /** Body-to-Enter gap; replaces NATIVE_CHAT_SUBMIT_DELAY_MS. */
  submitDelayMs: number
  /** True only when the agent's composer is observed still holding this send. */
  composerHoldsDraft: () => boolean
}

/** Gap between re-reading the composer after Enter. */
export const NATIVE_CHAT_SUBMIT_CONFIRM_MS = 1_000
/** Re-sent Enters before leaving the draft for the user. */
export const NATIVE_CHAT_SUBMIT_RETRY_MAX = 4

export function nativeChatSubmitDelayMs(options?: NativeChatSendOptions): number {
  return options?.submitConfirmation?.submitDelayMs ?? NATIVE_CHAT_SUBMIT_DELAY_MS
}

/** Extra time a send may hold the line re-checking that its Enter landed. */
export function submitConfirmDurationMs(options?: NativeChatSendOptions): number {
  return options?.submitConfirmation
    ? NATIVE_CHAT_SUBMIT_CONFIRM_MS * (NATIVE_CHAT_SUBMIT_RETRY_MAX + 1)
    : 0
}

/**
 * Write Enter. With a submit confirmation, keep owning the line and re-send Enter
 * while the composer still shows the draft — agy drops an Enter that arrives while
 * it is still expanding a paste or finishing a turn, leaving the prompt unsent.
 */
export function writeNativeChatSubmit(
  settings: RuntimeSettings,
  ptyId: string,
  options: NativeChatSendOptions | undefined,
  ctx: {
    delay: (ms: number, fn: () => void) => void
    markSubmitted: () => void
    markSubmitWritten: () => void
  }
): void {
  sendRuntimePtyInput(settings, ptyId, NATIVE_CHAT_SUBMIT)
  const confirmation = options?.submitConfirmation
  if (!confirmation) {
    ctx.markSubmitted()
    return
  }
  // Past this point a cancel must not Ctrl+U: the prompt may already be running.
  ctx.markSubmitWritten()
  let retries = 0
  const check = (): void => {
    let holdsDraft = false
    try {
      holdsDraft = confirmation.composerHoldsDraft()
    } catch {
      // An unreadable screen is unconfirmed; never press Enter blind.
    }
    if (!holdsDraft || retries >= NATIVE_CHAT_SUBMIT_RETRY_MAX) {
      ctx.markSubmitted()
      return
    }
    retries += 1
    sendRuntimePtyInput(settings, ptyId, NATIVE_CHAT_SUBMIT)
    ctx.delay(NATIVE_CHAT_SUBMIT_CONFIRM_MS, check)
  }
  ctx.delay(NATIVE_CHAT_SUBMIT_CONFIRM_MS, check)
}
