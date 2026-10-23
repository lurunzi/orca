// Enter for native chat sends, optionally re-checked until the composer lets go
// of the draft. Split from native-chat-runtime-send.ts to keep that file bounded.

import { sendRuntimePtyInput } from '@/runtime/runtime-terminal-inspection'
import { NATIVE_CHAT_SUBMIT_DELAY_MS } from '../../../../shared/native-chat-answer-stepping'
import { NATIVE_CHAT_SUBMIT } from './native-chat-send'
import type { NativeChatSendOptions } from './native-chat-runtime-send'

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
  ptyId: string,
  options: NativeChatSendOptions | undefined,
  ctx: {
    delay: (ms: number, fn: () => void) => void
    markSubmitted: () => void
    markSubmitWritten: () => void
  }
): void {
  sendRuntimePtyInput(ptyId, NATIVE_CHAT_SUBMIT, 'driving')
  const confirmation = options?.submitConfirmation
  if (!confirmation) {
    ctx.markSubmitted()
    return
  }
  // Past this point a cancel must not Ctrl+U: the prompt may already be running.
  ctx.markSubmitWritten()
  confirmNativeChatSubmit(
    confirmation,
    { delay: ctx.delay, finish: () => ctx.markSubmitted() },
    () => {
      sendRuntimePtyInput(ptyId, NATIVE_CHAT_SUBMIT, 'driving')
      return true
    }
  )
}

/** Share the observed-draft retry with reply cards that also require write acknowledgments. */
export function confirmNativeChatSubmit(
  confirmation: NativeChatSubmitConfirmation,
  ctx: { delay: (ms: number, fn: () => void) => void; finish: (confirmed: boolean) => void },
  writeSubmit: () => boolean | Promise<boolean>
): void {
  let retries = 0
  const check = (): void => {
    let holdsDraft = false
    try {
      holdsDraft = confirmation.composerHoldsDraft()
    } catch {
      // An unreadable screen is unconfirmed; never press Enter blind.
      ctx.finish(false)
      return
    }
    if (!holdsDraft || retries >= NATIVE_CHAT_SUBMIT_RETRY_MAX) {
      ctx.finish(!holdsDraft)
      return
    }
    retries += 1
    const next = (accepted: boolean): void => {
      if (accepted) {
        ctx.delay(NATIVE_CHAT_SUBMIT_CONFIRM_MS, check)
      } else {
        ctx.finish(false)
      }
    }
    const accepted = writeSubmit()
    if (typeof accepted === 'boolean') {
      next(accepted)
    } else {
      void accepted.then(next, () => ctx.finish(false))
    }
  }
  ctx.delay(NATIVE_CHAT_SUBMIT_CONFIRM_MS, check)
}
