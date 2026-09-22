import type { ClaudeSession } from './claude-structured-session-state'

/** Feed one provider frame to the session's context tracker. A `/context` twin
 *  publishes at once; a settled turn re-asks the CLI and publishes the answer
 *  only if the session is still the one that answered. */
export function observeClaudeContextUsage(input: {
  session: ClaudeSession
  message: Record<string, unknown>
  now: () => number
  timeoutMs: number | undefined
  isCurrent: () => boolean
}): void {
  const { session, now } = input
  const outcome = session.contextUsage.observe(input.message, now())
  if (outcome.changed) {
    session.events?.publish()
  }
  if (!outcome.capture) {
    return
  }
  void session.contextUsage
    .capture(
      () =>
        session.connection.getContextUsage(
          input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }
        ),
      now
    )
    .then((changed) => {
      // Why: a session replaced or ended during the read must not publish a
      // report for the child that answered it.
      if (changed && input.isCurrent()) {
        session.events?.publish()
      }
    })
}
