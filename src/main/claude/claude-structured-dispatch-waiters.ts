import type { ClaudeDispatchWaiter, ClaudeSession } from './claude-structured-session-state'
import type { ClaudeLateDispatchSettlement } from './claude-structured-dispatch'
import { DISPATCH_REJECTED_CANCELLED } from '../../shared/structured-agent-session-dispatch-rejection'

const MAX_RETIRED_DISPATCH_WAITERS = 64

export function forgetRetiredWaiter(session: ClaudeSession, waiter: ClaudeDispatchWaiter): void {
  const index = session.retiredDispatchWaiters.indexOf(waiter)
  if (index !== -1) {
    session.retiredDispatchWaiters.splice(index, 1)
  }
}

/**
 * A waiter with no deadline. The echo Claude sends is emitted when the provider
 * STARTS the turn, so a message queued behind a running turn cannot be echoed
 * until that turn ends — an interval bounded only by the previous turn. Elapsed
 * time is therefore not evidence about delivery, and nothing here expires.
 * Waiters are retired by process facts instead: a failed write, or child exit.
 */
export function waitForReplay(
  session: ClaudeSession,
  acceptsResult: boolean,
  sentUuid: string,
  replayContentKey: string,
  clientMessageId: string | null,
  requestedAt: number | null
): { waiter: ClaudeDispatchWaiter; promise: Promise<string | null> } {
  let waiter!: ClaudeDispatchWaiter
  const promise = new Promise<string | null>((resolve) => {
    waiter = {
      acceptsResult,
      clientMessageId,
      sentUuid,
      dispatchSequence: session.dispatchSequence,
      requestedAt,
      replayContentKey,
      resolve
    }
    session.dispatchWaiters.push(waiter)
  })
  return { waiter, promise }
}

export function forgetWaiter(session: ClaudeSession, waiter: ClaudeDispatchWaiter): void {
  const index = session.dispatchWaiters.indexOf(waiter)
  if (index !== -1) {
    session.dispatchWaiters.splice(index, 1)
  }
}

export function retireWaiter(session: ClaudeSession, waiter: ClaudeDispatchWaiter): void {
  forgetWaiter(session, waiter)
  if (!waiter.retired) {
    waiter.retired = true
    session.retiredDispatchWaiters.push(waiter)
    if (session.retiredDispatchWaiters.length > MAX_RETIRED_DISPATCH_WAITERS) {
      session.replayContentFallbackBlocked = true
      session.retiredDispatchWaiters.splice(
        0,
        session.retiredDispatchWaiters.length - MAX_RETIRED_DISPATCH_WAITERS
      )
    }
  }
}

export function settleCancelledClaudeDispatchWaiters(
  session: ClaudeSession,
  cancelledUuids: readonly string[],
  onSettledLate?: ClaudeLateDispatchSettlement
): void {
  const cancelled = new Set(cancelledUuids)
  const activeWaiters = session.dispatchWaiters.filter((waiter) => cancelled.has(waiter.sentUuid))
  const retiredWaiters = session.retiredDispatchWaiters.filter((waiter) =>
    cancelled.has(waiter.sentUuid)
  )
  for (const waiter of activeWaiters) {
    forgetWaiter(session, waiter)
    waiter.resolve(null)
  }
  for (const waiter of retiredWaiters) {
    forgetRetiredWaiter(session, waiter)
  }
  for (const waiter of [...activeWaiters, ...retiredWaiters]) {
    if (waiter.clientMessageId) {
      onSettledLate?.({
        clientMessageId: waiter.clientMessageId,
        state: 'rejected',
        reason: DISPATCH_REJECTED_CANCELLED
      })
    }
  }
}
