import { attachStructuredAgentSession } from './structured-agent-session-attach-orchestration'
import type { StructuredAgentSessionAttachContext } from './structured-agent-session-attach-context'
import type { StructuredAgentSessionLifecycleEvent } from './structured-agent-session-adapter'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from './structured-agent-session-host-types'
import type { StructuredAgentSessionSinkBarrier } from './structured-agent-session-event-sink'
import { resumeHeldStructuredAgentSession } from './structured-agent-session-hold-resume'
import {
  isStructuredAgentSessionRecoveryTicketCurrent,
  settleUnexpectedStructuredAgentSessionExit
} from './structured-agent-session-unexpected-exit'

export class StructuredAgentSessionEventRecovery {
  private readonly restarting = new Set<string>()

  constructor(
    private readonly context: {
      deps: StructuredAgentSessionHostDeps
      store: StructuredAgentSessionHostDeps['store']
      sessions: Map<string, StructuredAgentSessionHostSession>
      flushLifecycle: (sessionId: string) => Promise<StructuredAgentSessionSinkBarrier>
      publishFence: (sessionId: string, session: StructuredAgentSessionHostSession) => void
      publishStatus?: (sessionId: string) => void
      hasResumeCapableHolder: (sessionId: string) => boolean
      serialize: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
      now: () => number
      attachContext: () => StructuredAgentSessionAttachContext
      onBarrierError: (sessionId: string, error: unknown) => void
    }
  ) {}

  recoverAfterSinkFailure(sessionId: string, error: unknown): void {
    void this.restartProviderChild(
      sessionId,
      `journal sink failure: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  /**
   * Stops the provider child and lets the ordinary exit recovery re-acquire it, which re-reads the
   * launch environment. Resolves true when a child was stopped. Callers wanting no visible
   * interruption must gate on an idle session: a running turn is settled as interrupted.
   */
  restartProviderChild(sessionId: string, reason: string): Promise<boolean> {
    if (this.restarting.has(sessionId)) {
      return Promise.resolve(false)
    }
    this.restarting.add(sessionId)
    return this.context
      .serialize(sessionId, async () => {
        const session = this.context.sessions.get(sessionId)
        const stop =
          this.context.deps.adapter.forceCloseSession ?? this.context.deps.adapter.closeSession
        if (!session?.hasProviderChild || !stop) {
          return null
        }
        const fence = session.fence
        const acquisitionGeneration = session.acquisitionGeneration
        const stopped = await stop(sessionId)
        if (!stopped || !acquisitionGeneration) {
          return null
        }
        return {
          type: 'ended',
          sessionId,
          reason,
          cause: 'unexpected-exit',
          fence,
          acquisitionGeneration
        } as const
      })
      .then(async (event) => {
        if (!event) {
          return false
        }
        await this.handle(event)
        return true
      })
      .catch((recoveryError) => {
        this.context.onBarrierError(sessionId, recoveryError)
        return false
      })
      .finally(() => this.restarting.delete(sessionId))
  }

  async handle(event: StructuredAgentSessionLifecycleEvent): Promise<void> {
    const ticket = await settleUnexpectedStructuredAgentSessionExit(this.context, event)
    if (!ticket) {
      return
    }
    try {
      await resumeHeldStructuredAgentSession({
        sessionId: ticket.sessionId,
        deps: this.context.deps,
        now: this.context.now,
        attach: (params) =>
          attachStructuredAgentSession(
            this.context.attachContext(),
            'trusted-local:provider-exit-recovery',
            params,
            () => isStructuredAgentSessionRecoveryTicketCurrent(this.context, ticket)
          )
      })
    } catch (error) {
      if (isStructuredAgentSessionRecoveryTicketCurrent(this.context, ticket)) {
        this.context.onBarrierError(ticket.sessionId, error)
      }
    }
  }
}
