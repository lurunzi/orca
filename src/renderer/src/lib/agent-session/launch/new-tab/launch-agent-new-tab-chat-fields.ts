import { newTabLaunchFields } from '@/lib/launch-agent-new-tab-fields'
import { readNativeChatDiscoveredModelIdsForWorktree } from '@/components/native-chat/native-chat-session-option-discovery'
import { seedNativeChatAppliedSessionOptions } from '../../../../../../shared/native-chat/input/native-chat-session-option-cache'
import type { SessionOptionValue } from '../../../../../../shared/native-chat/input/native-chat-session-options'

type NewTabFieldArgs = Parameters<typeof newTabLaunchFields>
type SessionOptions = Record<string, SessionOptionValue> | undefined

/** Fork: transcript-chat fields of a new agent tab, including the model a new chat starts from. */
export function newTabChatLaunchFields(
  args: NewTabFieldArgs[0] & { worktreeId: string; sessionOptions?: SessionOptions },
  context: NewTabFieldArgs[1],
  promptDelivery: NewTabFieldArgs[2]
) {
  const fields = newTabLaunchFields(args, context, promptDelivery)
  const startsFromRememberedModel =
    fields.viewMode === 'chat' &&
    args.sessionOptions === undefined &&
    args.agentSessionLaunchPlan === undefined
  return {
    ...fields,
    startupInputs: {
      agent: args.agent,
      ...(startsFromRememberedModel
        ? {
            rememberedNativeChatTerminalLaunch: {
              discoveredModelIds: readNativeChatDiscoveredModelIdsForWorktree(
                args.agent,
                args.worktreeId
              )
            }
          }
        : {})
    },
    pasteRoute: { agent: args.agent, hostPlatform: context.resolvedLaunchPlatform },
    /** Host-routed launches carry the options the startup plan resolved, remembered ones included. */
    hostSessionOptions: (planned: SessionOptions) => {
      const options = planned ?? args.sessionOptions
      return options ? { sessionOptions: options } : {}
    },
    seedChatTab: (tabId: string, planned: SessionOptions) => {
      if (fields.viewMode === 'chat' && planned) {
        seedNativeChatAppliedSessionOptions(tabId, args.agent, planned)
      }
    }
  }
}
