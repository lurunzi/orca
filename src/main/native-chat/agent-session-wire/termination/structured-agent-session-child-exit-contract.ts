import type { SubmissionRejectionFact } from '../../../../shared/agent-session/failures/agent-session-failure'
import type { StructuredAgentSessionHostSession } from '../host/structured-agent-session-host-types'
import type { StaleStructuredAgentSessionStateJournal } from './structured-agent-session-stale-state-settlement'
import type { DeadGenerationJournal } from './structured-agent-session-unfinished-work'

export type StructuredAgentSessionChildExit = {
  deathEvidenceKind?: 'kill-delivered'
  heldSends?: ReadonlySet<string>
  expected: boolean
  /** Log only; failure supplies user-facing wording. */
  reason: string
  failure?: SubmissionRejectionFact
  observedAt?: number
  startupUnanswered?: true
}

export type StructuredAgentSessionChildExitSession = Pick<
  StructuredAgentSessionHostSession,
  'child' | 'lastEndedChild'
> & { journal: DeadGenerationJournal & StaleStructuredAgentSessionStateJournal }

export type StructuredAgentSessionGenerationEnded = (
  sessionId: string,
  options?: { restate?: boolean }
) => void
