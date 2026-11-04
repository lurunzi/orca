import { useAppStore } from '../../store'
import type { AgentStatusState } from '../../../../shared/agent-status-types'
import {
  nativeChatHookHasWorkingSubagents,
  resolveNativeChatHookState
} from '../../../../shared/native-chat/native-chat-live-status'
import { nativeChatTerminalErrorText } from '../../../../shared/native-chat/native-chat-terminal-error'
import type { AgentType } from '../../../../shared/agent-status-types'

export function useNativeChatHookStatus(
  paneKey: string,
  agent: AgentType = '',
  sessionId: string | null = null
): readonly [AgentStatusState | null, number | null, boolean, string | null, number | null] {
  // Primitive selectors avoid rerenders for unrelated status changes.
  const state = useAppStore((store) =>
    resolveNativeChatHookState(store.agentStatusByPaneKey[paneKey])
  )
  const stateStartedAt = useAppStore(
    (store) => store.agentStatusByPaneKey[paneKey]?.stateStartedAt ?? null
  )
  const hasWorkingSubagents = useAppStore((store) =>
    nativeChatHookHasWorkingSubagents(store.agentStatusByPaneKey[paneKey])
  )
  const errorText = useAppStore((store) =>
    nativeChatTerminalErrorText(store.agentStatusByPaneKey[paneKey], agent, sessionId)
  )
  const errorAt = useAppStore((store) =>
    errorText ? (store.agentStatusByPaneKey[paneKey]?.mainAgent?.stateStartedAt ?? null) : null
  )
  return [state, stateStartedAt, hasWorkingSubagents, errorText, errorAt]
}
