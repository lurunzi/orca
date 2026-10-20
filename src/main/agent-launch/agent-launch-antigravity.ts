import { initialAntigravityChatView } from '../../shared/antigravity-chat-launch-view'
import type { AgentLaunchExecution, AgentLaunchSurfaceExecution } from './agent-launch-execution'
import { createLaunchPromptInputs } from './agent-launch-legacy-host'
import { readAgentLaunchModeSettings, type AgentLaunchModeReceipt } from './agent-launch-mode'

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

/** Fork: a created worktree's prompt inputs plus the desktop's chat default, so the startup
 *  Antigravity it launches opens as its transcript chat too. */
export function worktreeCreateLaunchInputs(
  execution: AgentLaunchExecution,
  mode: AgentLaunchModeReceipt['mode']
): ReturnType<typeof createLaunchPromptInputs> & { nativeChatDefault?: boolean } {
  return {
    ...createLaunchPromptInputs(execution, mode),
    nativeChatDefault: execution.terminalOnly ? false : execution.intent.nativeChatDefault
  }
}
