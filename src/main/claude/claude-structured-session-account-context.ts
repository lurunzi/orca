import type { ClaudeStructuredLaunch } from './claude-structured-launch-resolution'
import type {
  ClaudeSession,
  ClaudeStructuredSessionAdapterDeps
} from './structured/claude-structured-session-state'

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
