import type { CodexAcquisitionRegistry, CodexSession } from './codex-structured-session-state'

/** Whether the starting or published child of this acquisition is still running. */
export function codexLiveProviderProcessHold(
  sessions: ReadonlyMap<string, CodexSession>,
  acquisitions: CodexAcquisitionRegistry
): (sessionId: string, acquisitionGeneration: string) => boolean {
  return (sessionId, acquisitionGeneration) => {
    const session = sessions.get(sessionId)
    const starting = acquisitions.get(sessionId)
    if (starting?.acquisitionGeneration === acquisitionGeneration) {
      return !starting.exitProven && starting.window.connection?.pid !== undefined
    }
    return (
      session?.acquisitionGeneration === acquisitionGeneration &&
      session.connection.pid !== undefined &&
      !session.ended &&
      session.exitObservedAt === undefined
    )
  }
}
