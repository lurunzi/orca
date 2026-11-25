import { useMemo, useState } from 'react'
import { AgentSessionContinuationDialog } from '@/components/agent-session-continuation/AgentSessionContinuationDialog'
import type { AgentSessionContinuationRequest } from '../../../../shared/agent-session/conversation-context/agent-session-continuation'
import { useAppStore } from '@/store'
import { useAgentStatusSelector } from '@/runtime/agent-status/use-agent-status'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import type { AgentStatusEntry } from '../../../../shared/agent-status/contracts/agent-status-types'
import {
  prepareStructuredChatContinuation,
  hasStructuredChatTranscriptText
} from './structured-chat-continuation-request'
import type { NativeChatFileLinkContext } from './links/actions/native-chat-file-link-context'

const hasStatusTranscriptPath = (status: AgentStatusEntry | undefined): boolean =>
  Boolean(status?.providerSession?.transcriptPath?.trim())

/** Owns the "Continue in New Session…" request and dialog for a structured Chat. */
export function useStructuredChatContinuation(args: {
  fileLinkContext: NativeChatFileLinkContext | null
  groupId?: string
  paneKey: string
  agent: string
  messages: readonly NativeChatMessage[]
}): {
  onContinue: (() => void) | undefined
  dialog: React.JSX.Element | null
} {
  const { fileLinkContext, groupId, paneKey, agent, messages } = args
  const hasTranscriptPath = useAgentStatusSelector(paneKey, hasStatusTranscriptPath)
  const hasMessageText = useMemo(() => hasStructuredChatTranscriptText(messages), [messages])
  const [request, setRequest] = useState<AgentSessionContinuationRequest | null>(null)

  const onContinue =
    fileLinkContext && (hasTranscriptPath || hasMessageText)
      ? () => {
          const next = prepareStructuredChatContinuation({
            agent,
            messages,
            status: useAppStore.getState().agentStatusByPaneKey.get(paneKey),
            paneKey,
            worktreeId: fileLinkContext.worktreeId,
            workspacePath: fileLinkContext.worktreePath,
            groupId
          })
          if (next) {
            setRequest(next)
          }
        }
      : undefined

  const dialog = request ? (
    <AgentSessionContinuationDialog
      open
      request={request}
      onOpenChange={(open) => {
        if (!open) {
          setRequest(null)
        }
      }}
    />
  ) : null

  return { onContinue, dialog }
}
