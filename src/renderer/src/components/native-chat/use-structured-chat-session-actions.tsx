import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import type { NativeChatFileLinkContext } from './native-chat-file-link'
import { NativeChatOrchestrationIdentityMenuItem } from './NativeChatOrchestrationIdentityMenuItem'
import {
  StructuredAgentSessionHeaderActions,
  StructuredAgentSessionTitleActions
} from './StructuredAgentSessionHeaderActions'
import { StructuredChatContinueMenuItem } from './StructuredChatContinueMenuItem'
import { useStructuredChatContinuation } from './use-structured-chat-continuation'

/** Header cluster (floating, or `titleActions` inside the pane header), continuation dialog and
 *  session menu items of a structured Chat. */
export function useStructuredChatSessionActions(args: {
  fileLinkContext: NativeChatFileLinkContext | null
  tabId: string
  groupId?: string
  paneKey: string
  agent: string
  sessionId: string
  target: RuntimeClientTarget
  messages: readonly NativeChatMessage[]
  hasTerminalPaneActions: boolean
  inbox?: React.ReactNode
}): {
  header: React.JSX.Element
  titleActions: React.JSX.Element
  dialog: React.ReactNode
  menuItems: React.JSX.Element
} {
  const continuation = useStructuredChatContinuation(args)
  return {
    header: (
      <StructuredAgentSessionHeaderActions
        tabId={args.tabId}
        groupId={args.groupId}
        onContinueInNewSession={continuation.onContinue}
        inbox={args.inbox}
      />
    ),
    titleActions: (
      <StructuredAgentSessionTitleActions
        onContinueInNewSession={continuation.onContinue}
        inbox={args.inbox}
        variant="pane-title"
      />
    ),
    dialog: continuation.dialog,
    menuItems: (
      <>
        {/* Terminal-pane actions already carry their own Continue item. */}
        {continuation.onContinue && !args.hasTerminalPaneActions ? (
          <StructuredChatContinueMenuItem onSelect={continuation.onContinue} />
        ) : null}
        <NativeChatOrchestrationIdentityMenuItem sessionId={args.sessionId} target={args.target} />
      </>
    )
  }
}
