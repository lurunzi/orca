import type { StructuredAgentSessionHostSession } from '../host/structured-agent-session-host-types'
import type { StaleStructuredAgentSessionStateJournal } from './structured-agent-session-stale-state-settlement'
import type { DeadGenerationJournal } from './structured-agent-session-unfinished-work'

export type StructuredAgentSessionChildExitSession = Pick<
  StructuredAgentSessionHostSession,
  'child' | 'lastEndedChild'
> & { journal: DeadGenerationJournal & StaleStructuredAgentSessionStateJournal }

export type StructuredAgentSessionGenerationEnded = (
  sessionId: string,
  options?: { restate?: boolean }
) => void
