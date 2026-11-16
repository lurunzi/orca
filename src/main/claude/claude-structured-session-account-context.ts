import type { ClaudeStructuredLaunch } from './structured/launch/claude-structured-launch-resolution'
import type {
  ClaudeSession,
  ClaudeStructuredSessionAdapterDeps
} from './structured/claude-structured-session-state'
import type { publishClaudeSessionAttempt } from './structured/claude-structured-session-publication'
import { restoreClaudePromptSuggestion } from './claude-prompt-suggestion'

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

/** Fork: wraps the upstream publisher so an acquired session gets its account context and
 *  restored prompt suggestion. */
export function withClaudeAccountContext(
  publish: typeof publishClaudeSessionAttempt,
  launch: ClaudeStructuredLaunch,
  deps: Pick<
    ClaudeStructuredSessionAdapterDeps,
    'readFastModeAccountSupport' | 'promptSuggestionStore'
  >
) {
  return async (publication: Parameters<typeof publishClaudeSessionAttempt>[0]): Promise<void> => {
    configureClaudeSessionAccountContext(publication.session, launch, deps)
    await publish(publication)
    // After the pre-publish frames, which are not a new turn and must not retire it.
    restoreClaudePromptSuggestion(
      publication.session,
      deps.promptSuggestionStore?.memory(publication.sessionId)
    )
  }
}
