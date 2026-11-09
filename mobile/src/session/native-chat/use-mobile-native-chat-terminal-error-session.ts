import { useMemo } from 'react'
import {
  nativeChatTerminalErrorText,
  withNativeChatTerminalError
} from '../../../../src/shared/native-chat/native-chat-terminal-error'
import type { NativeChatMessage } from '../../../../src/shared/native-chat/native-chat-types'
import type { MobileNativeChatTab } from './mobile-native-chat-eligibility'

export function useMobileNativeChatTerminalErrorSession<
  TSession extends { messages: NativeChatMessage[] }
>(args: {
  session: TSession
  structured: boolean
  status: MobileNativeChatTab['agentStatus'] | null
  agent: string | null
  sessionId: string | null
}): TSession {
  const { session, structured, status, agent, sessionId } = args
  const terminalError = structured
    ? null
    : nativeChatTerminalErrorText(status, agent ?? '', sessionId)
  const terminalErrorAt = status?.mainAgent?.stateStartedAt
  return useMemo(() => {
    const messages = withNativeChatTerminalError(session.messages, terminalError, terminalErrorAt)
    return messages === session.messages ? session : { ...session, messages }
  }, [session, terminalError, terminalErrorAt])
}
