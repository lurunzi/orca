import type { CodexSession } from './codex-structured-session-state'

/** Fork: a call that changes the thread drops the session's next-prompt suggestion. */
export function dropCodexPromptSuggestion<T extends CodexSession | undefined>(session: T): T {
  session?.promptSuggestion?.invalidate()
  return session
}

/** Fork: a cancel request, after dropping its session's suggestion. */
export function cancelDroppingCodexPromptSuggestion<T extends { sessionId: string }>(
  sessions: ReadonlyMap<string, CodexSession>,
  request: T
): T {
  dropCodexPromptSuggestion(sessions.get(request.sessionId))
  return request
}

export function readCodexPromptSuggestion(
  sessions: ReadonlyMap<string, CodexSession>,
  sessionId: string
): string | null {
  return sessions.get(sessionId)?.promptSuggestion?.read() ?? null
}
