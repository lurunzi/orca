import {
  agentSessionFailureFact,
  type SubmissionRejectionFact
} from '../../../shared/agent-session-failure'
import type { StructuredAgentSessionLifecycleEvent } from './structured-agent-session-adapter'
import { stopAgentSessionProviderRoot } from './structured-agent-session-provider-exit-proof'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from './structured-agent-session-host-types'
import type { StructuredAgentSessionSinkBarrier } from './structured-agent-session-event-sink'
import { settleStructuredAgentSessionProviderStarted } from './structured-agent-session-provider-started'
import { settleUnexpectedStructuredAgentSessionExit } from './structured-agent-session-unexpected-exit'

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
      serialize: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
      now: () => number
    }
  ) {}

  private get exitContext() {
    return { ...this.context, logger: this.context.deps.logger }
  }

  recoverAfterSinkFailure(sessionId: string, error: unknown): void {
    void this.restartProviderChild(
      sessionId,
      `journal sink failure: ${error instanceof Error ? error.message : String(error)}`,
      // Orca stopped the provider because its own journal failed.
      agentSessionFailureFact('hostFault')
    )
  }

  /**
   * Stops the provider child and lets the ordinary exit recovery re-acquire it, which re-reads the
   * launch environment. Resolves true when a child was stopped. Callers wanting no visible
   * interruption must gate on an idle session: a running turn is settled as interrupted.
   */
  restartProviderChild(
    sessionId: string,
    reason: string,
    failure?: SubmissionRejectionFact
  ): Promise<boolean> {
    if (this.restarting.has(sessionId)) {
      return Promise.resolve(false)
    }
    this.restarting.add(sessionId)
    return this.context
      .serialize(sessionId, async () => {
        const child = this.context.sessions.get(sessionId)?.child
        const stop =
          this.context.deps.adapter.forceCloseSession ?? this.context.deps.adapter.closeSession
        if (!child || !stop) {
          return null
        }
        const { fence, generation: acquisitionGeneration } = child
        const stopped = await stopAgentSessionProviderRoot(() => stop(sessionId))
        if (!stopped || !acquisitionGeneration) {
          return null
        }
        return {
          type: 'ended',
          sessionId,
          reason,
          ...(failure ? { failure } : {}),
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
        this.context.deps.logger.warn(
          'stopping a provider after its journal failed did not finish',
          { scope: 'sink-failure-recovery', sessionId, error: recoveryError }
        )
        return false
      })
      .finally(() => this.restarting.delete(sessionId))
  }

  /** An exit is settled and shown; nothing restarts the child. The next send does, through the
   *  delivery loop, which also owns any message still queued. */
  async handle(event: StructuredAgentSessionLifecycleEvent): Promise<void> {
    if (event.type === 'started') {
      return settleStructuredAgentSessionProviderStarted(this.context, event)
    }
    await settleUnexpectedStructuredAgentSessionExit(this.exitContext, event)
  }
}
