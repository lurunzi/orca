import { initialTranscriptChatView } from '../../../shared/transcript-chat-launch-view'
import type { TuiAgent } from '../../../shared/tui-agent'
import type { AgentLaunchExecutionContext } from '@/lib/launch-agent-execution-context'
import { useAppStore } from '@/store'

/** Fork: the launch fields a new agent tab carries beyond upstream's — the terminal-backed transcript
 *  view and, for host-routed prompts, the platform that quotes the pasted prompt. */
export function newTabLaunchFields(
  args: {
    agent: TuiAgent
    prompt?: string
    requestedSurface?: 'chat' | 'terminal'
    agentSessionLaunchPlan?: { requestedSurface?: 'chat' | 'terminal' }
  },
  context: AgentLaunchExecutionContext,
  promptDelivery: string
): {
  viewMode: 'chat' | undefined
  tab: { launchAgent: TuiAgent; viewMode?: 'chat' }
  hostRoute: { agent: TuiAgent; viewMode?: 'chat'; hostPlatform: NodeJS.Platform }
} {
  const draft = args.prompt?.trim() ?? ''
  const viewMode = initialTranscriptChatView({
    agent: args.agent,
    requestedSurface: args.requestedSurface ?? args.agentSessionLaunchPlan?.requestedSurface,
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
