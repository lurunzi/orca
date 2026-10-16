import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session-journal-types'
import {
  AGENT_SESSION_HISTORY_MAX_LIMIT,
  type AgentSessionHistoryResult
} from '../../../../shared/agent-session-wire'
import { sessionInboxHistoryItem } from '../../../../shared/session-inbox-journal-items'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import { nativeChatInboxScopeKey } from './native-chat-inbox-marks'

/** Bound history reads so opening the panel cannot load an unbounded journal. */
const MAX_HISTORY_PAGES = 10

export type NativeChatInboxHistoryState = 'idle' | 'loading' | 'complete' | 'partial' | 'failed'

export type NativeChatInboxHistory = {
  /** Older rows the inbox reads, beyond what the chat has loaded. */
  items: readonly AgentJournalRenderItem[]
  state: NativeChatInboxHistoryState
  /** Reads the session's earlier rows once; a failed read may be retried. */
  load: () => void
}

const NO_ITEMS: readonly AgentJournalRenderItem[] = []

async function readInboxHistory(
  target: RuntimeClientTarget,
  sessionId: string,
  isCurrent: () => boolean
): Promise<{ items: AgentJournalRenderItem[]; complete: boolean } | null> {
  const kept: AgentJournalRenderItem[] = []
  let result = await callStructuredAgentSession<AgentSessionHistoryResult>(
    target,
    'agentSession.history',
    { sessionId, direction: 'tail', limit: AGENT_SESSION_HISTORY_MAX_LIMIT }
  )
  for (let page = 1; ; page += 1) {
    if (!isCurrent() || !result.ok) {
      return null
    }
    for (const item of result.page.items) {
      const relevant = sessionInboxHistoryItem(item)
      if (relevant) {
        kept.push(relevant)
      }
    }
    const oldest = result.page.window.oldest
    if (!result.page.hasOlder || !oldest) {
      return { items: kept, complete: true }
    }
    if (page >= MAX_HISTORY_PAGES) {
      return { items: kept, complete: false }
    }
    result = await callStructuredAgentSession<AgentSessionHistoryResult>(
      target,
      'agentSession.history',
      { sessionId, direction: 'before', cursor: oldest, limit: AGENT_SESSION_HISTORY_MAX_LIMIT }
    )
    // A page that does not move older would loop forever.
    if (result.ok && result.page.window.oldest?.sequence === oldest.sequence) {
      return { items: kept, complete: false }
    }
  }
}

/**
 * The session's earlier journal rows, read on demand through the same history reads the chat
 * pages with, so the inbox also lists what was recorded before the chat's loaded window.
 */
export function useNativeChatInboxHistory(args: {
  sessionId: string
  target: RuntimeClientTarget
  /** The chat's window does not reach the journal's start. */
  hasOlder: boolean
}): NativeChatInboxHistory {
  const { sessionId, target, hasOlder } = args
  const [snapshot, setSnapshot] = useState<{
    key: string
    items: readonly AgentJournalRenderItem[]
    state: NativeChatInboxHistoryState
  }>({ key: '', items: NO_ITEMS, state: 'idle' })
  const key = nativeChatInboxScopeKey(target, sessionId)
  const keyRef = useRef(key)
  const targetRef = useRef(target)
  useEffect(() => {
    keyRef.current = key
    targetRef.current = target
  })
  const current = snapshot.key === key ? snapshot : { key, items: NO_ITEMS, state: 'idle' as const }
  const state: NativeChatInboxHistoryState =
    current.state === 'idle' && !hasOlder ? 'complete' : current.state
  const load = useCallback(() => {
    if (state !== 'idle' && state !== 'failed') {
      return
    }
    const requested = key
    const isCurrent = (): boolean => keyRef.current === requested
    setSnapshot({ key: requested, items: NO_ITEMS, state: 'loading' })
    readInboxHistory(targetRef.current, sessionId, isCurrent)
      .then((read) => {
        if (isCurrent()) {
          setSnapshot({
            key: requested,
            items: read?.items ?? NO_ITEMS,
            state: read === null ? 'failed' : read.complete ? 'complete' : 'partial'
          })
        }
      })
      .catch(() => {
        if (isCurrent()) {
          setSnapshot({ key: requested, items: NO_ITEMS, state: 'failed' })
        }
      })
  }, [key, sessionId, state])
  return { items: current.items, state, load }
}
