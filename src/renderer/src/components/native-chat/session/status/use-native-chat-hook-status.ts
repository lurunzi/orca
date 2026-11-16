import { useAgentStatusSelector } from '@/runtime/agent-status/use-agent-status'
import type {
  AgentStatusState,
  AgentType
} from '../../../../../../shared/agent-status/contracts/agent-status-types'
import {
  nativeChatHookHasWorkingSubagents,
  resolveNativeChatHookState
} from '../../../../../../shared/native-chat/native-chat-live-status'
import { nativeChatTerminalErrorText } from '../../../../../../shared/native-chat/native-chat-terminal-error'

export function useNativeChatHookStatus(
  paneKey: string,
  agent: AgentType = '',
  sessionId: string | null = null
): readonly [AgentStatusState | null, number | null, boolean, string | null, number | null] {
  // Primitive selectors avoid rerenders for unrelated status changes.
  const state = useAgentStatusSelector(paneKey, resolveNativeChatHookState)
  const stateStartedAt = useAgentStatusSelector(paneKey, (entry) => entry?.stateStartedAt ?? null)
  const hasWorkingSubagents = useAgentStatusSelector(paneKey, nativeChatHookHasWorkingSubagents)
  const errorText = useAgentStatusSelector(paneKey, (entry) =>
    nativeChatTerminalErrorText(entry, agent, sessionId)
  )
  const errorAt = useAgentStatusSelector(paneKey, (entry) =>
    errorText ? (entry?.mainAgent?.stateStartedAt ?? null) : null
  )
  return [state, stateStartedAt, hasWorkingSubagents, errorText, errorAt]
}
