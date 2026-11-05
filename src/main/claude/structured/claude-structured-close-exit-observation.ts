import { AgentSessionAcquisitionRootExitObservedError } from '../../native-chat/agent-session-wire/structured-agent-session-acquisition-errors'
import type { StructuredAgentSessionAcquireInput } from '../../native-chat/agent-session-wire/structured-agent-session-adapter'
import type {
  ClaudeAcquireCallbacks,
  ClaudeSession,
  ClaudeStructuredSessionAdapterDeps
} from './claude-structured-session-state'

export function markClaudeCloseAwaitingRootExit(session: ClaudeSession, verdict: Error): void {
  if (
    verdict instanceof AgentSessionAcquisitionRootExitObservedError &&
    verdict.deathEvidenceKind === 'kill-delivered'
  ) {
    session.closeAwaitingRootExit = true
  }
}

export function reportClaudeLateRootExit(
  sessionId: string,
  session: ClaudeSession | null,
  input: Pick<StructuredAgentSessionAcquireInput, 'events'>,
  deps: Pick<ClaudeStructuredSessionAdapterDeps, 'now'>,
  callbacks: Pick<ClaudeAcquireCallbacks, 'emit'>
): void {
  if (session?.closeAwaitingRootExit) {
    callbacks.emit(null, input.events, {
      type: 'ended',
      sessionId,
      reason: 'claude process exited after close',
      cause: 'requested-close',
      fence: session.fence,
      acquisitionGeneration: session.acquisitionGeneration,
      observedAt: deps.now?.() ?? Date.now()
    })
  }
}
