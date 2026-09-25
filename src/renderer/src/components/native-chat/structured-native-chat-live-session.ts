import type { AgentType } from '../../../../shared/agent-status-types'
import type { NativeChatLiveSession } from './native-chat-live-session-contract'
import type { useStructuredAgentSession } from './use-structured-agent-session'

type StructuredSessionController = Pick<
  ReturnType<typeof useStructuredAgentSession>,
  | 'messages'
  | 'status'
  | 'isWorking'
  | 'error'
  | 'hasOlder'
  | 'loadingOlder'
  | 'olderHistoryGeneration'
  | 'loadOlder'
>

/** Maps the structured session controller onto the live-session shape the shared chat view reads. */
export function structuredNativeChatLiveSession(
  controller: StructuredSessionController,
  sessionId: string,
  agent: AgentType
): NativeChatLiveSession {
  return {
    messages: controller.messages,
    status:
      controller.status === 'error'
        ? 'error'
        : controller.status === 'loading'
          ? 'loading'
          : controller.isWorking
            ? 'working'
            : controller.messages.length === 0
              ? 'empty'
              : 'ready',
    sessionId,
    agent,
    ...(controller.error ? { error: controller.error } : {}),
    hasMore: controller.hasOlder,
    loadingEarlier: controller.loadingOlder,
    olderHistoryGeneration: controller.olderHistoryGeneration,
    loadEarlier: controller.loadOlder,
    readPhase:
      controller.status === 'loading'
        ? 'loading'
        : controller.status === 'error'
          ? 'error'
          : 'ready'
  }
}
