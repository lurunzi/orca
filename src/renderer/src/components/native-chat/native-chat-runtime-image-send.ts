import { agentImagePasteWrites, formatAgentImagePath } from '../../../../shared/agent-image-paste'
import type { AgentType } from '../../../../shared/agent-status-types'
import { sendRuntimePtyInput } from '@/runtime/runtime-terminal-inspection'
import type { getSettingsForAgentTabRuntimeOwner } from '@/lib/agent-paste-draft'
import { buildNativeChatImagePasteBytes, buildNativeChatPasteBytes } from './native-chat-send'
import { enqueueNativeChatPtySend } from './native-chat-pty-send-queue'
import {
  clearConfirmDurationMs,
  clearThenWrite,
  clearUnsubmittedAgentInput,
  nativeChatSubmitDelayMs,
  sendNativeChatMessage,
  submitConfirmDurationMs,
  writeNativeChatSubmit,
  type NativeChatSendHandle,
  type NativeChatSendOptions
} from './native-chat-runtime-send'

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
  const submitDelayMs = nativeChatSubmitDelayMs(options)
  const durationMs =
    (trimmedText.length > 0
      ? NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS + submitDelayMs
      : submitDelayMs) +
    clearConfirmDurationMs(options) +
    submitConfirmDurationMs(options)
  return enqueueNativeChatPtySend(
    ptyId,
    durationMs,
    (ctx) => {
      const { isCancelled, delay } = ctx
      if (isCancelled()) {
        return
      }
      clearThenWrite(settings, ptyId, options, delay, () => {
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
          sendRuntimePtyInput(settings, ptyId, payload)
        }
        if (trimmedText.length > 0) {
          delay(NATIVE_CHAT_IMAGE_ATTACHMENT_SETTLE_MS, () => {
            sendRuntimePtyInput(settings, ptyId, buildNativeChatPasteBytes(text))
            delay(submitDelayMs, () => writeNativeChatSubmit(settings, ptyId, options, ctx))
          })
          return
        }
        delay(submitDelayMs, () => writeNativeChatSubmit(settings, ptyId, options, ctx))
      })
    },
    {
      onCancelUnsubmitted: () => clearUnsubmittedAgentInput(settings, ptyId, options)
    }
  )
}
