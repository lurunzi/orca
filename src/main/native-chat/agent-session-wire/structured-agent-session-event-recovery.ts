import {
  agentSessionFailureFact,
  type SubmissionRejectionFact
} from '../../../shared/agent-session-failure'
import type { StructuredAgentSessionLifecycleEvent } from './structured-agent-session-adapter'
import { holdUnsentSends } from '../agent-session-journal/journal-unsent-send-hold'
import { stopAgentSessionProviderRoot } from './structured-agent-session-provider-exit-proof'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession,
  StructuredAgentSessionProviderChild,
  StructuredAgentSessionProviderChildIdentity
} from './structured-agent-session-host-types'
import type { StructuredAgentSessionSinkBarrier } from './structured-agent-session-event-sink'
import { settleStructuredAgentSessionOptionsReported } from './structured-agent-session-provider-started'
import {
  endExitedStructuredAgentSessionChildUnderSerialize,
  settleStructuredAgentSessionChildExit,
  type StructuredAgentSessionChildExit,
  type StructuredAgentSessionChildExitContext,
  type StructuredAgentSessionGenerationEnded
} from './structured-agent-session-child-exit'
import type { StructuredAgentSessionHostRuntimeState } from './structured-agent-session-host-runtime-state'
import { openStructuredAgentSessionProviderChild } from './structured-agent-session-provider-open'

export class StructuredAgentSessionEventRecovery {
  private readonly restarting = new Set<string>()

  constructor(
    private readonly context: {
      deps: StructuredAgentSessionHostDeps
      store: StructuredAgentSessionHostDeps['store']
      sessions: Map<string, StructuredAgentSessionHostSession>
      flushLifecycle: (sessionId: string) => Promise<StructuredAgentSessionSinkBarrier>
      publishStatus?: (sessionId: string) => void
      generationEnded: StructuredAgentSessionGenerationEnded
      serialize: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
      now: () => number
      runtimeState: StructuredAgentSessionHostRuntimeState
      wakeDelivery: (sessionId: string) => Promise<void>
      stopStartingChild: (
        sessionId: string,
        child: StructuredAgentSessionProviderChildIdentity
      ) => void
      failStartingChild: (
        sessionId: string,
        child: StructuredAgentSessionProviderChildIdentity,
        error: unknown,
        openMs: number
      ) => Promise<void>
      trackOpen: <T>(open: Promise<T>) => Promise<T>
    }
  ) {}

  openProviderChild = (
    sessionId: string,
    child: StructuredAgentSessionProviderChildIdentity
  ): void => {
    void this.context.trackOpen(
      openStructuredAgentSessionProviderChild(this.context, sessionId, child)
    )
  }

  private get exitContext(): StructuredAgentSessionChildExitContext {
    const { deps, runtimeState } = this.context
    return {
      ...this.context,
      logger: deps.logger,
      startupAttempts: runtimeState.startupAttempts,
      startFlights: runtimeState.startFlights,
      holdUnrunSends: async (sessionId, fence, cause) => {
        const journal = this.context.sessions.get(sessionId)?.journal
        if (journal) {
          await holdUnsentSends(journal, {
            fence,
            hold: { cause },
            unrun: (s) => !finalizingStructuredAgentSessionInput(journal, s.clientMessageId)
          })
        }
      },
      route: {
        runtimeState,
        acknowledgeRelease: (sessionId) => deps.adapter.acknowledgeSessionRelease?.(sessionId)
      },
      abortBound: (sessionId) => runtimeState.acquireAborts.abortBound(sessionId)
    }
  }

  endExitedChildUnderSerialize = (
    sessionId: string,
    child: StructuredAgentSessionProviderChild,
    exit: StructuredAgentSessionChildExit
  ): Promise<void> =>
    endExitedStructuredAgentSessionChildUnderSerialize(this.exitContext, sessionId, child, exit)

  recoverAfterSinkFailure(sessionId: string, error: unknown): void {
    const child = this.context.sessions.get(sessionId)?.child
    if (!child) {
      return
    }
    void this.restartProviderChild(
      sessionId,
      `journal sink failure: ${error instanceof Error ? error.message : String(error)}`,
      // Orca stopped the provider because its own journal failed.
      agentSessionFailureFact('hostFault'),
      { child, heldSends: new Set(child.heldSends?.()) }
    )
  }

  /**
   * Stops and ends the provider child; the next send re-acquires it, which re-reads the launch
   * environment. Resolves true when a child was stopped. Callers wanting no visible
   * interruption must gate on an idle session: a running turn is settled as interrupted.
   * `observed` pins the child and the sends it held when the restart was decided.
   */
  restartProviderChild(
    sessionId: string,
    reason: string,
    failure?: SubmissionRejectionFact,
    observed?: { child: StructuredAgentSessionProviderChild; heldSends: ReadonlySet<string> }
  ): Promise<boolean> {
    if (this.restarting.has(sessionId)) {
      return Promise.resolve(false)
    }
    this.restarting.add(sessionId)
    return this.context
      .serialize(sessionId, async () => {
        const session = this.context.sessions.get(sessionId)
        const child = session?.child
        const stop =
          this.context.deps.adapter.forceCloseSession ?? this.context.deps.adapter.closeSession
        if (!child || !session || (observed && child !== observed.child)) {
          return false
        }
        if (failure) {
          // Close reports raised while stopping must carry the failure, not read as quiet rest.
          child.close = {
            ...(child.close ?? {
              cause: 'host-stop',
              recorded: Promise.resolve(null),
              requestedAt: session.journal.cursor()
            }),
            reason,
            failure
          }
        }
        const stopped = stop && (await stopAgentSessionProviderRoot(() => stop(sessionId)))
        if (!stopped) {
          return false
        }
        // End in this step so later close reports cannot misclassify this shutdown as quiet rest.
        await this.endExitedChildUnderSerialize(sessionId, child, {
          expected: false,
          ...(stopped === 'kill-delivered' ? { deathEvidenceKind: stopped } : {}),
          ...(observed ? { heldSends: observed.heldSends } : {}),
          reason,
          ...(failure ? { failure } : {})
        })
        return true
      })
      .catch((recoveryError: unknown) => {
        this.context.deps.logger.warn(
          'stopping a provider after its journal failed did not finish',
          { scope: 'sink-failure-recovery', sessionId, error: recoveryError }
        )
        return false
      })
      .finally(() => this.restarting.delete(sessionId))
  }

  /** Settle/report exits without automatic restart; next-send delivery owns queued work and startup. */
  async handle(event: StructuredAgentSessionLifecycleEvent): Promise<void> {
    if (event.type === 'options-reported') {
      return settleStructuredAgentSessionOptionsReported(this.context, event)
    }
    await settleStructuredAgentSessionChildExit(this.exitContext, event)
  }
}
import { finalizingStructuredAgentSessionInput } from './structured-agent-session-handing-over'
