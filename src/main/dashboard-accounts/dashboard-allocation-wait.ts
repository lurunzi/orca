import { delayUnlessAborted } from '../../shared/concurrency/abort-aware-delay'
import {
  DashboardAllocationError,
  DashboardAllocationPendingError
} from './dashboard-allocation-protocol'

export const DASHBOARD_ALLOCATION_WAIT_MS = 60000
const pollMs = 250
export type DashboardAllocationWaitOptions = {
  signal?: AbortSignal
  deadlineAt?: number
}
/** Retries `read` while it reports a pending allocation, bounded by the wait budget, deadline and signal. */
export async function waitForDashboardAllocation<T>(
  read: () => Promise<T>,
  options: DashboardAllocationWaitOptions = {}
): Promise<T> {
  const signal = options.signal ?? new AbortController().signal
  const limit = Math.min(Date.now() + DASHBOARD_ALLOCATION_WAIT_MS, options.deadlineAt ?? Infinity)
  for (;;) {
    try {
      return await read()
    } catch (error) {
      if (!(error instanceof DashboardAllocationPendingError) || Date.now() + pollMs > limit) {
        throw new DashboardAllocationError()
      }
    }
    await delayUnlessAborted(pollMs, signal)
    if (signal.aborted) {
      throw new DashboardAllocationError()
    }
  }
}
