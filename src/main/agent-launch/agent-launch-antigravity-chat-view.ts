import { initialAntigravityChatView } from '../../shared/antigravity-chat-launch-view'
import type { AgentLaunchSurfaceExecution } from './agent-launch-execution'
import { readAgentLaunchModeSettings } from './agent-launch-mode'

/** Fork: an Antigravity terminal agent opens as its transcript chat when Chat UI is on. */
export function antigravityTerminalViewMode(
  execution: AgentLaunchSurfaceExecution,
  connectionId: string | null | undefined
): 'chat' | 'terminal' {
  const { intent } = execution
  return (
    initialAntigravityChatView({
      agent: intent.agent,
      settings: execution.terminalOnly
        ? undefined
        : readAgentLaunchModeSettings(execution.runtime, intent.nativeChatDefault),
      connectionId,
      ...(intent.prompt?.delivery === 'draft' ? { draft: intent.prompt.text } : {})
    }) ?? 'terminal'
  )
}
