import { useCallback, useState, type RefObject } from 'react'
import { structuredAgentLabel } from '@/lib/structured-agent-session-launch-label'
import type { NativeChatComposerHandle } from './native-chat-composer-types'
import type { NativeChatStructuredViewProps } from './native-chat-view-types'
import { NativeChatInboxButton } from './NativeChatInboxButton'
import { useNativeChatFileLinkContext } from './use-native-chat-file-link-context'
import { useNativeChatInbox } from './use-native-chat-inbox'
import { nativeChatInboxScopeKey } from './native-chat-inbox-marks'
import type { NativeChatJumpRequest } from './use-native-chat-jump-request'
import type { useStructuredAgentSession } from './use-structured-agent-session'

/** A structured chat's inbox: its header button, and the jumps it asks the transcript to make. */
export type StructuredNativeChatInboxController = Pick<
  ReturnType<typeof useStructuredAgentSession>,
  'epoch' | 'journalItems' | 'hasOlder' | 'isWorking' | 'send'
>

export function useStructuredNativeChatInbox(
  props: Pick<NativeChatStructuredViewProps, 'agent' | 'sessionId' | 'tabId' | 'target'>,
  controller: StructuredNativeChatInboxController,
  composerRef: RefObject<NativeChatComposerHandle | null>
): { button: React.JSX.Element | null; jumpRequest: NativeChatJumpRequest | null } {
  const fileLinkContext = useNativeChatFileLinkContext(props.tabId)
  const key = nativeChatInboxScopeKey(props.target, props.sessionId, controller.epoch)
  const [jump, setJump] = useState<{ key: string; request: NativeChatJumpRequest } | null>(null)
  const jumpToMessage = useCallback(
    (messageId: string) => {
      setJump((previous) => ({
        key,
        request: { messageId, requestId: (previous?.request.requestId ?? 0) + 1 }
      }))
    },
    [key]
  )
  // Claude only for now: its tools are the ones the host serves.
  const enabled = props.agent === 'claude'
  const inbox = useNativeChatInbox({
    enabled,
    sessionId: props.sessionId,
    epoch: controller.epoch,
    target: props.target,
    journalItems: controller.journalItems,
    hasOlder: controller.hasOlder,
    isWorking: controller.isWorking,
    root: fileLinkContext?.worktreePath ?? null,
    send: (text) => controller.send(text, []) !== false,
    insertIntoComposer: (text) => {
      const composer = composerRef.current
      return composer ? composer.insertTypedText(text) && composer.focus() : false
    },
    jumpToMessage
  })
  return {
    button: enabled ? (
      <NativeChatInboxButton inbox={inbox} agentLabel={structuredAgentLabel('claude')} />
    ) : null,
    jumpRequest: jump?.key === key ? jump.request : null
  }
}
