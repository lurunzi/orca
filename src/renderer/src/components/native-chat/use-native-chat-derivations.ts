import { useCallback, useMemo } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import {
  deriveNativeChatContextUsage,
  type NativeChatContextUsage
} from '../../../../shared/native-chat-context-usage'
import { nativeChatLocalCommand } from '../../../../shared/native-chat-local-commands'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { formatNativeChatContextUsageAnswer } from './native-chat-context-usage-answer'

/** What the chat host derives from a terminal session's transcript for its
 *  composer: the context estimate the ring shows, and the answer to `/context`,
 *  which Claude's TUI paints as a grid the chat never sees. */
export function useNativeChatDerivations(
  agent: AgentType,
  messages: readonly NativeChatMessage[]
): {
  contextUsage: NativeChatContextUsage | null
  answerCommandLocally: (command: string) => string | null
} {
  const contextUsage = useMemo(
    () => deriveNativeChatContextUsage(messages, agent),
    [agent, messages]
  )
  const answerCommandLocally = useCallback(
    (command: string): string | null =>
      nativeChatLocalCommand(agent, command) === 'context'
        ? formatNativeChatContextUsageAnswer(contextUsage)
        : null,
    [agent, contextUsage]
  )
  return { contextUsage, answerCommandLocally }
}
