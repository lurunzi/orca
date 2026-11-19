import { sendRuntimePtyInputVerified } from '@/runtime/hosted-terminals/input/runtime-terminal-verified-input'
import { enqueueNativeChatPtySend } from './native-chat-pty-send-queue'
import {
  clearConfirmDurationMs,
  clearThenWrite,
  clearUnsubmittedAgentInput,
  type NativeChatSendOptions
} from './native-chat-input-clear'
import {
  confirmNativeChatSubmit,
  submitConfirmDurationMs,
  type NativeChatSubmitConfirmation
} from '../../../native-chat-submit-confirmation'
import { NATIVE_CHAT_SUBMIT } from '../../../../../../../shared/native-chat/input/composer/native-chat-paste-bytes'
import { afterNativeChatPasteLands, readNativeChatInputLine } from './native-chat-paste-landed'

/** `afterPasteOf`: hold this write (Enter) until the input line shows that pasted message. */
export type NativeChatObservedWrite = {
  data: string
  delayBeforeMs: number
  afterPasteOf?: string
}

export function sendNativeChatObservedWrites(
  ptyId: string,
  writes: readonly NativeChatObservedWrite[],
  options: NativeChatSendOptions & {
    stopOnUnconfirmed?: boolean
    settleDelayMs?: number
    submitConfirmation?: NativeChatSubmitConfirmation
  }
) {
  let lineTouched = false
  // Dismiss answer cards only after provider acknowledgment.
  const writeOptions = options.onDeliverySettled
    ? ({ requireWriteSettlement: true } as const)
    : undefined
  return enqueueNativeChatPtySend(
    ptyId,
    writes.reduce((total, write) => total + write.delayBeforeMs, 0) +
      clearConfirmDurationMs(options) +
      submitConfirmDurationMs(options) +
      (options.settleDelayMs ?? 0),
    ({ isCancelled, delay, markSubmitted, markSubmitWritten, markWriteStarted }) => {
      let reportedUnconfirmed = false
      let acknowledged = true
      let lineWasEmpty = false
      const whenReady = (write: NativeChatObservedWrite, send: () => void): void =>
        write.afterPasteOf !== undefined
          ? afterNativeChatPasteLands({
              readInputLine: options.readInputLine,
              lineWasEmpty,
              text: write.afterPasteOf,
              delay,
              submit: send
            })
          : send()
      const writeAt = (index: number): void => {
        if (isCancelled()) {
          return
        }
        const write = writes[index]
        if (!write) {
          const finish = (confirmed = true): void => {
            if (isCancelled()) {
              return
            }
            const settled = acknowledged && confirmed
            options.onDeliverySettled?.(settled)
            markSubmitted(settled ? 'submitted' : 'uncertain')
          }
          if (options.submitConfirmation) {
            markSubmitWritten()
            confirmNativeChatSubmit(options.submitConfirmation, { delay, finish }, () =>
              isCancelled()
                ? false
                : sendRuntimePtyInputVerified(ptyId, NATIVE_CHAT_SUBMIT, 'driving', writeOptions)
            )
          } else if (options.settleDelayMs) {
            delay(options.settleDelayMs, finish)
          } else {
            finish()
          }
          return
        }
        const send = (): void => {
          if (isCancelled()) {
            return
          }
          markWriteStarted()
          void sendRuntimePtyInputVerified(ptyId, write.data, 'driving', writeOptions)
            .then((accepted) => {
              if (isCancelled()) {
                return
              }
              if (!accepted) {
                options.onWriteRejected?.()
                options.onDeliverySettled?.(false)
                markSubmitted(index === 0 ? 'not-submitted' : 'uncertain')
                return
              }
              writeAt(index + 1)
            })
            // Lost acknowledgments must not replay bytes; submit the possibly delivered body as on the unobserved path.
            .catch(() => {
              if (isCancelled()) {
                return
              }
              acknowledged = false
              if (!reportedUnconfirmed) {
                reportedUnconfirmed = true
                options.onWriteUnconfirmed?.()
              }
              if (options.stopOnUnconfirmed) {
                options.onDeliverySettled?.(false)
                markSubmitted('uncertain')
                return
              }
              writeAt(index + 1)
            })
        }
        if (write.delayBeforeMs > 0) {
          delay(write.delayBeforeMs, () => whenReady(write, send))
        } else {
          whenReady(write, send)
        }
      }
      clearThenWrite(
        ptyId,
        options,
        delay,
        () => {
          lineWasEmpty = readNativeChatInputLine(options.readInputLine) === ''
          writeAt(0)
        },
        () => markSubmitted('not-submitted'),
        () => {
          lineTouched = true
        }
      )
    },
    {
      // Why: cancelling while still waiting on the composer must keep the parked draft.
      onCancelUnsubmitted: () => {
        if (lineTouched) {
          clearUnsubmittedAgentInput(ptyId, options)
        }
      }
    }
  )
}
