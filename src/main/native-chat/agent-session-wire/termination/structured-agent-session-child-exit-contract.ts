import type { StructuredAgentSessionHostSession } from '../host/structured-agent-session-host-types'
import type { StructuredAgentSessionLeftoverSettlementInput } from './structured-agent-session-leftover-settlement'

export type StructuredAgentSessionChildExitSession = Pick<
  StructuredAgentSessionHostSession,
  'child' | 'lastEndedChild' | 'workChanged'
> & { journal: StructuredAgentSessionLeftoverSettlementInput['journal'] }

export type StructuredAgentSessionGenerationEnded = (
  sessionId: string,
  /** settled: the dead generation's leftovers are written. */
  options?: { restate?: boolean; settled?: boolean }
) => void
