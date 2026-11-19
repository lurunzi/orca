import type { ClaudeStructuredLaunch } from './structured/launch/claude-structured-launch-resolution'
import type {
  ClaudeSession,
  ClaudeStructuredSessionAdapterDeps
} from './structured/claude-structured-session-state'
import type { publishClaudeSessionAttempt } from './structured/startup/claude-structured-session-publication'

export function configureClaudeSessionAccountContext(
  session: ClaudeSession,
  launch: ClaudeStructuredLaunch,
  deps: Pick<ClaudeStructuredSessionAdapterDeps, 'readFastModeAccountSupport'>
): void {
  const read = deps.readFastModeAccountSupport
  if (read) {
    session.readFastModeAccountSupport = async (settings, timeoutMs) =>
      read(launch, settings, timeoutMs, await session.connection.initializationResult())
  }
}

/** Fork: wraps the upstream publisher so an acquired session gets its account context. */
export function withClaudeAccountContext(
  publish: typeof publishClaudeSessionAttempt,
  launch: ClaudeStructuredLaunch,
  deps: Pick<ClaudeStructuredSessionAdapterDeps, 'readFastModeAccountSupport'>
) {
  return async (publication: Parameters<typeof publishClaudeSessionAttempt>[0]): Promise<void> => {
    configureClaudeSessionAccountContext(publication.session, launch, deps)
    await publish(publication)
  }
}
