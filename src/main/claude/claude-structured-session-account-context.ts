import type { ClaudeStructuredLaunch } from './structured/launch/claude-structured-launch-resolution'
import type {
  ClaudeSession,
  ClaudeStructuredSessionAdapterDeps
} from './structured/claude-structured-session-state'
import { publishClaudeSessionAttempt } from './structured/claude-structured-session-publication'
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

/** Fork: publishes an acquired session with its account context and restored prompt suggestion. */
export async function publishClaudeSessionWithAccountContext(
  publication: Parameters<typeof publishClaudeSessionAttempt>[0],
  launch: ClaudeStructuredLaunch,
  deps: Pick<
    ClaudeStructuredSessionAdapterDeps,
    'readFastModeAccountSupport' | 'promptSuggestionStore'
  >
): Promise<void> {
  configureClaudeSessionAccountContext(publication.session, launch, deps)
  await publishClaudeSessionAttempt(publication)
  // After the pre-publish frames, which are not a new turn and must not retire it.
  restoreClaudePromptSuggestion(
    publication.session,
    deps.promptSuggestionStore?.memory(publication.sessionId)
  )
}
