import type { AiVaultSession } from '../../../shared/ai-vault-types'

const STORAGE_KEY = 'orca.cursorTranscript.offeredSessions'
const MAX_OFFERS = 200
/** A transcript untouched this long belongs to a worker that is no longer running. */
export const CURSOR_TRANSCRIPT_LIVE_WINDOW_MS = 15 * 60_000

export function cursorTranscriptOfferKey(
  hostId: string,
  worktreeId: string,
  sessionId: string
): string {
  return JSON.stringify([hostId, worktreeId, sessionId])
}

export function isCursorTranscriptLive(session: AiVaultSession, now = Date.now()): boolean {
  const modified = Date.parse(session.modifiedAt)
  return Number.isFinite(modified) && now - modified <= CURSOR_TRANSCRIPT_LIVE_WINDOW_MS
}

function readOffers(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : []
  } catch {
    return []
  }
}

// Why persisted: an in-memory set forgot user-closed tabs, so every restart reopened them.
export function wasCursorTranscriptOffered(key: string): boolean {
  return readOffers().includes(key)
}

export function recordCursorTranscriptOffer(key: string): void {
  const offers = readOffers().filter((entry) => entry !== key)
  offers.push(key)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(offers.slice(-MAX_OFFERS)))
  } catch {
    // Storage full or unavailable: discovery still de-duplicates via the open tab itself.
  }
}
