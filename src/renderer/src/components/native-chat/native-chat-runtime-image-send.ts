import { sendNativeChatObservedWrites } from './native-chat-observed-send'
import { agentImagePasteWrites, formatAgentImagePath } from '../../../../shared/agent-image-paste'
import type { AgentType } from '../../../../shared/agent-status-types'
import { sendRuntimePtyInput } from '@/runtime/runtime-terminal-inspection'
import type { getSettingsForAgentTabRuntimeOwner } from '@/lib/agent-paste-draft'
import { NATIVE_CHAT_SUBMIT_DELAY_MS } from '../../../../shared/native-chat-answer-stepping'
import {
  buildNativeChatImagePasteBytes,
  buildNativeChatPasteBytes,
  NATIVE_CHAT_SUBMIT
} from './native-chat-send'
import { enqueueNativeChatPtySend } from './native-chat-pty-send-queue'
import {
  clearConfirmDurationMs,
  clearThenWrite,
  clearUnsubmittedAgentInput
} from './native-chat-input-clear'
import {
  sendNativeChatMessage,
  type NativeChatSendHandle,
  type NativeChatSendOptions
} from './native-chat-runtime-send'
import {
  nativeChatSubmitDelayMs,
  submitConfirmDurationMs,
  writeNativeChatSubmit
} from './native-chat-submit-confirmation'

export const NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS = 300

type RuntimeSettings = ReturnType<typeof getSettingsForAgentTabRuntimeOwner>

export function sendNativeChatMessageWithImageAttachments(
  agent: AgentType,
  settings: RuntimeSettings,
  ptyId: string,
  text: string,
  imagePaths: readonly string[],
  options?: NativeChatSendOptions
): NativeChatSendHandle {
  if (imagePaths.length === 0) {
    return sendNativeChatMessage(settings, ptyId, text, options)
  }
  const trimmedText = text.trim()
  if (options?.onWriteRejected) {
    const writes = agentImagePasteWrites(
      agent,
      imagePaths.map((path) => buildNativeChatImagePasteBytes(formatAgentImagePath(agent, path))),
      trimmedText.length > 0
    ).map((data) => ({ data, delayBeforeMs: 0 }))
    if (trimmedText) {
      writes.push({
        data: buildNativeChatPasteBytes(text),
        delayBeforeMs: NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS
      })
    }
    writes.push({ data: NATIVE_CHAT_SUBMIT, delayBeforeMs: NATIVE_CHAT_SUBMIT_DELAY_MS })
    return sendNativeChatObservedWrites(settings, ptyId, writes, options)
  }
  const submitDelayMs = nativeChatSubmitDelayMs(options)
  const durationMs =
    (trimmedText.length > 0
      ? NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS + submitDelayMs
      : submitDelayMs) +
    clearConfirmDurationMs(options) +
    submitConfirmDurationMs(options)
  let lineTouched = false
  return enqueueNativeChatPtySend(
    ptyId,
    durationMs,
    (ctx) => {
      const { isCancelled, delay } = ctx
      if (isCancelled()) {
        return
      }
      clearThenWrite(
        settings,
        ptyId,
        options,
        delay,
        () => {
          if (isCancelled()) {
            return
          }
          for (const payload of agentImagePasteWrites(
            agent,
            imagePaths.map((path) =>
              buildNativeChatImagePasteBytes(formatAgentImagePath(agent, path))
            ),
            trimmedText.length > 0
          )) {
            sendRuntimePtyInput(settings, ptyId, payload, 'driving')
          }
          if (trimmedText.length > 0) {
            delay(NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS, () => {
              sendRuntimePtyInput(settings, ptyId, buildNativeChatPasteBytes(text), 'driving')
              delay(submitDelayMs, () => writeNativeChatSubmit(settings, ptyId, options, ctx))
            })
            return
          }
          delay(submitDelayMs, () => writeNativeChatSubmit(settings, ptyId, options, ctx))
        },
        () => {
          lineTouched = true
        }
      )
    },
    {
      // Why: cancelling while still waiting on the composer must keep the parked draft.
      onCancelUnsubmitted: () => {
        if (lineTouched) {
          clearUnsubmittedAgentInput(settings, ptyId, options)
        }
      }
    }
  )
}
