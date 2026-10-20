const MAX_RESTING_SUGGESTIONS = 100

/** Keep composer text across a deliberate provider restart, until the next acquisition. */
export class RestingPromptSuggestions {
  private readonly bySession = new Map<string, string>()

  keep(sessionId: string, suggestion: string | null | undefined): void {
    this.bySession.delete(sessionId)
    if (!suggestion) {
      return
    }
    this.bySession.set(sessionId, suggestion)
    if (this.bySession.size > MAX_RESTING_SUGGESTIONS) {
      const oldest = this.bySession.keys().next().value
      if (oldest !== undefined) {
        this.bySession.delete(oldest)
      }
    }
  }

  async preserve(
    sessionId: string,
    suggestion: string | null,
    stop: () => Promise<boolean>
  ): Promise<boolean> {
    this.keep(sessionId, suggestion)
    let stopped = false
    try {
      stopped = await stop()
      return stopped
    } finally {
      if (!stopped) {
        this.drop(sessionId)
      }
    }
  }

  drop(sessionId: string): void {
    this.bySession.delete(sessionId)
  }

  read(sessionId: string): string | null {
    return this.bySession.get(sessionId) ?? null
  }
}
