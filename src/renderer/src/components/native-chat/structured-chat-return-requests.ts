// A return to chat asked for from the agent terminal, handed to the session's Chat tab.
//
// The terminal has no fenced session transport of its own, so it activates the Chat and leaves the
// request here; the Chat sends it through its own handoff controls once its live read confirms
// the terminal still owns the session. A request nobody takes expires rather than firing late.

import { useEffect, useSyncExternalStore } from 'react'
import type {
  AgentSessionHandoffDirection,
  AgentSessionHandoffMode,
  AgentSessionHandoffStatus
} from '../../../../shared/agent-session-wire'
import { structuredTuiOwnerTerminalMatches } from './structured-tui-owner-resolution'

export const STRUCTURED_CHAT_RETURN_REQUEST_TTL_MS = 15_000

type StructuredChatReturnRequest = {
  terminalTabId: string
  ptyId: string | null
  requestedAt: number
}

const requests = new Map<string, StructuredChatReturnRequest>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function requestStructuredChatReturn(
  sessionId: string,
  from: { terminalTabId: string; ptyId: string | null },
  now = Date.now()
): void {
  requests.set(sessionId, { ...from, requestedAt: now })
  emit()
}

function peekStructuredChatReturn(
  sessionId: string,
  now: number
): StructuredChatReturnRequest | null {
  const request = requests.get(sessionId)
  if (!request) {
    return null
  }
  if (now - request.requestedAt > STRUCTURED_CHAT_RETURN_REQUEST_TTL_MS) {
    requests.delete(sessionId)
    return null
  }
  return request
}

export function resetStructuredChatReturnRequestsForTests(): void {
  requests.clear()
  emit()
}

/** Sends a pending terminal-side return once this Chat reads the terminal as the idle owner. */
export function useStructuredChatReturnRequest(args: {
  sessionId: string
  status: AgentSessionHandoffStatus | null
  request: (direction: AgentSessionHandoffDirection, mode: AgentSessionHandoffMode) => void
}): void {
  const { request, sessionId, status } = args
  const pending = useSyncExternalStore(
    subscribe,
    () => requests.get(sessionId) ?? null,
    () => null
  )
  useEffect(() => {
    if (!pending) {
      return
    }
    const current = peekStructuredChatReturn(sessionId, Date.now())
    if (!current) {
      emit()
      return
    }
    // Any other state may be a stale read from while the Chat was hidden; wait for the live one.
    if (status?.owner !== 'tui' || status.phase !== 'idle') {
      const expiresIn = current.requestedAt + STRUCTURED_CHAT_RETURN_REQUEST_TTL_MS + 1 - Date.now()
      const timer = setTimeout(() => {
        peekStructuredChatReturn(sessionId, Date.now())
        emit()
      }, expiresIn)
      return () => clearTimeout(timer)
    }
    requests.delete(sessionId)
    emit()
    // The owner may have moved to another terminal since the click; that one keeps it.
    if (
      status.terminal &&
      !structuredTuiOwnerTerminalMatches(status, {
        tabId: current.terminalTabId,
        ptyIds: current.ptyId ? [current.ptyId] : []
      })
    ) {
      return
    }
    request('to-native', 'after-turn')
    return undefined
  }, [pending, request, sessionId, status])
}
