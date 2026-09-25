import {
  buildAgentSessionContinuationPrompt,
  type AgentSessionContinuationRequest
} from '@/lib/agent-session-continuation'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { isNoiseMessage } from '../../../../shared/native-chat-noise'
import { isTextBlock, type NativeChatMessage } from '../../../../shared/native-chat-types'
import { isTuiAgent } from '../../../../shared/tui-agent-config'

function transcriptLine(message: NativeChatMessage): string | null {
  if (isNoiseMessage(message)) {
    return null
  }
  const text = message.blocks
    .filter(isTextBlock)
    .map((block) => block.text)
    .join('')
    .trim()
  return text ? `${message.role}: ${text}` : null
}

export function hasStructuredChatTranscriptText(messages: readonly NativeChatMessage[]): boolean {
  return messages.some((message) => transcriptLine(message) !== null)
}

export function structuredChatTranscriptText(messages: readonly NativeChatMessage[]): string {
  return messages
    .map(transcriptLine)
    .filter((line): line is string => line !== null)
    .join('\n\n')
}

export function prepareStructuredChatContinuation(args: {
  agent: string
  messages: readonly NativeChatMessage[]
  status: AgentStatusEntry | undefined
  paneKey: string
  worktreeId: string
  workspacePath: string
  groupId?: string | null
}): AgentSessionContinuationRequest | null {
  const { status, workspacePath } = args
  const transcriptPath = status?.providerSession?.transcriptPath?.trim() || null
  const source = {
    // Why: the loaded chat may be one page of history; the host transcript is the full record.
    capturedText: transcriptPath ? '' : structuredChatTranscriptText(args.messages),
    sourceAgent: isTuiAgent(args.agent) ? args.agent : null,
    sourceLabel: args.paneKey,
    sourceWorkingDirectory: workspacePath,
    transcriptPath,
    lastPrompt: status?.prompt || null,
    lastAssistantMessage: status?.lastAssistantMessageIsToolOutput
      ? null
      : status?.lastAssistantMessage || null
  }
  if (!buildAgentSessionContinuationPrompt(source, 'focused')) {
    return null
  }
  return {
    source,
    worktreeId: args.worktreeId,
    groupId: args.groupId ?? null,
    workspacePath,
    initialCwd: workspacePath,
    // Why: same telemetry bucket as the terminal pane's Continue action; the enum is host-validated.
    launchSource: 'terminal_context_menu'
  }
}
