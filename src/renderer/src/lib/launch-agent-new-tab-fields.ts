import { initialAntigravityChatView } from '../../../shared/antigravity-chat-launch-view'
import type { TuiAgent } from '../../../shared/tui-agent'
import type { AgentLaunchExecutionContext } from '@/lib/launch-agent-execution-context'
import { useAppStore } from '@/store'

/** Fork: the launch fields a new agent tab carries beyond upstream's — the Antigravity transcript
 *  view and, for host-routed prompts, the platform that quotes the pasted prompt. */
export function newTabLaunchFields(
  args: { agent: TuiAgent; prompt?: string },
  context: AgentLaunchExecutionContext,
  promptDelivery: string
): {
  viewMode: 'chat' | undefined
  tab: { launchAgent: TuiAgent; viewMode?: 'chat' }
  hostRoute: { agent: TuiAgent; viewMode?: 'chat'; hostPlatform: NodeJS.Platform }
} {
  const draft = args.prompt?.trim() ?? ''
  const viewMode = initialAntigravityChatView({
    agent: args.agent,
    settings: useAppStore.getState().settings,
    connectionId: context.worktreeSshConnectionId,
    ...(promptDelivery === 'draft' && draft ? { draft } : {})
  })
  const view = viewMode ? { viewMode } : {}
  return {
    viewMode,
    tab: { launchAgent: args.agent, ...view },
    hostRoute: { agent: args.agent, ...view, hostPlatform: context.resolvedLaunchPlatform }
  }
}
