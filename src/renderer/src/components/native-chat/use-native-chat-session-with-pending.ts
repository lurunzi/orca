import { useMemo } from 'react'
import { useAppStore } from '../../store'
import {
  pendingSendsAsMessages,
  type NativeChatPendingSend
} from '../../../../shared/native-chat/transcript/native-chat-pending-sends'
import {
  deriveNativeChatStreamingText,
  nativeChatStreamingMessage
} from '../../../../shared/native-chat/native-chat-streaming'
import {
  commandMarkersAsMessages,
  type NativeChatCommandMarker
} from './session/terminal/delivery/native-chat-command-marker'
import type { NativeChatLiveSession } from './session/terminal/read/native-chat-live-session-contract'

/** The session a terminal chat draws: its transcript plus command markers, the hook's streaming reply and pending echoes. */
export function useNativeChatSessionWithPending<T extends NativeChatLiveSession>(args: {
  paneKey: string
  session: T
  pending: NativeChatPendingSend[]
  commandMarkers: readonly NativeChatCommandMarker[]
  working: boolean
  workingEpoch: number | null | undefined
}): T {
  const { paneKey, session, pending, commandMarkers, working, workingEpoch } = args
  // Preview the in-progress hook reply before its completed transcript turn arrives.
  const hookPreview = useAppStore((s) => s.agentStatusByPaneKey[paneKey]?.lastAssistantMessage)
  // Tool stdout/errors ride the same field for status-card previews; they are not the reply.
  const hookPreviewIsToolOutput = useAppStore(
    (s) => s.agentStatusByPaneKey[paneKey]?.lastAssistantMessageIsToolOutput === true
  )
  const pendingMessages = useMemo(
    () => pendingSendsAsMessages(pending, session.messages, workingEpoch),
    [pending, session.messages, workingEpoch]
  )
  const messagesWithPending = useMemo(
    () =>
      pendingMessages.length === 0 ? session.messages : [...session.messages, ...pendingMessages],
    [session.messages, pendingMessages]
  )
  const streamingText = useMemo(
    () =>
      deriveNativeChatStreamingText({
        messages: messagesWithPending,
        previewText: hookPreview,
        working,
        previewIsToolOutput: hookPreviewIsToolOutput
      }),
    [messagesWithPending, hookPreview, working, hookPreviewIsToolOutput]
  )
  return useMemo<T>(() => {
    if (pending.length === 0 && commandMarkers.length === 0 && !streamingText) {
      return session
    }
    return {
      ...session,
      messages: [
        ...session.messages,
        ...commandMarkersAsMessages(commandMarkers),
        ...(streamingText ? [nativeChatStreamingMessage(streamingText)] : []),
        ...pendingMessages
      ]
    }
  }, [session, pending, pendingMessages, commandMarkers, streamingText])
}
