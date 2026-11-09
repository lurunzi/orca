import type { AgentStatusEntry, AgentType } from '../agent-status/contracts/agent-status-types'
import type { NativeChatMessage } from './native-chat-types'
import { readAntigravityNativeError } from '../antigravity-native-error'

export function nativeChatTerminalErrorText(
  entry: AgentStatusEntry | null | undefined,
  agent: AgentType,
  sessionId: string | null
): string | null {
  return agent === 'antigravity' &&
    entry?.agentType === agent &&
    entry.mainAgent?.state === 'done' &&
    entry.mainAgent.outcome === 'failure' &&
    entry.lastAssistantMessageIsToolOutput === true &&
    entry.sessionBoundary !== true &&
    (!entry.providerSession || entry.providerSession.id === sessionId)
    ? (readAntigravityNativeError([`⚠ ${entry.lastAssistantMessage ?? ''}`, '>'])?.text ?? null)
    : null
}

export function withNativeChatTerminalError(
  messages: NativeChatMessage[],
  text: string | null | undefined,
  timestamp: number | null | undefined
): NativeChatMessage[] {
  if (
    !text ||
    timestamp == null ||
    messages.some(
      (message) =>
        message.role === 'user' && message.timestamp != null && message.timestamp > timestamp
    )
  ) {
    return messages
  }
  return [
    ...messages,
    {
      id: `terminal-error:${timestamp}`,
      role: 'system',
      blocks: [{ type: 'text', text, tone: 'error' }],
      timestamp,
      source: 'hook'
    }
  ]
}
