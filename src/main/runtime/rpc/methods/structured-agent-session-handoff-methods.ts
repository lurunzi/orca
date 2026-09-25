// `agentSession.*` ownership calls: switching a session between chat and its agent terminal, and
// the user's release of an ownerless reservation that no probe can clear.

import { defineMethod } from '../core'
import {
  requireStructuredHost as requireHost,
  structuredCallerFor as callerFor
} from './structured-agent-session-gate'
import {
  HandoffParams,
  HandoffStatusParams,
  ReleaseReservationParams
} from './structured-agent-session-schemas'

export const STRUCTURED_AGENT_SESSION_HANDOFF_METHODS = [
  defineMethod({
    name: 'agentSession.requestHandoff',
    params: HandoffParams,
    handler: async (params, ctx) => requireHost(ctx).requestHandoff(callerFor(ctx), params)
  }),
  defineMethod({
    name: 'agentSession.handoffStatus',
    params: HandoffStatusParams,
    handler: async (params, ctx) => requireHost(ctx).handoffStatus(params.sessionId)
  }),
  defineMethod({
    // Admission gate, not cleanup: a successful release resumes the chat's provider child.
    name: 'agentSession.releaseReservation',
    params: ReleaseReservationParams,
    handler: async (params, ctx) =>
      requireHost(ctx).releaseReservation(params.sessionId, params.expectedRuntimeFence)
  })
]
