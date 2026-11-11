import type { UsageLimitAccountReading } from '../../../rate-limits/usage-limit-account-reading'
import type { StructuredAgentSessionHostDeps } from '../host/structured-agent-session-host-types'

/** Providers roll a window over a little after its stated reset. */
const USAGE_LIMIT_RESET_GRACE_MS = 15_000

export type UsageLimitAccountHold =
  | { kind: 'none' }
  /** The account's own usage says the limit lasts until then. */
  | { kind: 'wait'; until: number }
  /** The last reading predates the reset or the cut, so it cannot vouch for room yet. */
  | { kind: 'refresh' }

/** Holds a due cut until a usage reading taken after its reset shows room again. */
export function usageLimitAccountHold(
  cut: { resetsAt: number; turnEndedAt: number },
  reading: UsageLimitAccountReading | null,
  now: number
): UsageLimitAccountHold {
  if (!reading) {
    return { kind: 'none' }
  }
  if (reading.exhausted && reading.resetsAt !== null) {
    if (now < reading.resetsAt + USAGE_LIMIT_RESET_GRACE_MS) {
      return { kind: 'wait', until: reading.resetsAt }
    }
    return { kind: 'refresh' }
  }
  if (reading.exhausted || reading.checkedAt < Math.max(cut.resetsAt, cut.turnEndedAt)) {
    return { kind: 'refresh' }
  }
  return { kind: 'none' }
}

/** Reads each provider's usage once per sweep and asks for a fresh reading at most once a minute. */
export class UsageLimitAccountGate {
  private readonly readings = new Map<string, UsageLimitAccountReading | null>()
  private refreshedAt = -Infinity

  constructor(
    private readonly deps: () => {
      host: Pick<StructuredAgentSessionHostDeps, 'usageLimitAutoContinue'>
      now: () => number
    }
  ) {}

  private source = () => this.deps().host.usageLimitAutoContinue

  beginPass(): void {
    this.readings.clear()
  }

  /** Only a sweep about to send may ask for a refresh; status reads before the reset must not. */
  hold(
    provider: string | undefined,
    cut: { resetsAt: number; turnEndedAt: number },
    mayRefresh: boolean
  ): UsageLimitAccountHold {
    if (provider === undefined) {
      return { kind: 'none' }
    }
    const reading = this.readings.has(provider)
      ? (this.readings.get(provider) ?? null)
      : (this.source()?.readAccountUsage?.(provider) ?? null)
    this.readings.set(provider, reading)
    const now = this.deps().now()
    const hold = usageLimitAccountHold(cut, reading, now)
    if (mayRefresh && hold.kind === 'refresh' && now - this.refreshedAt >= 60_000) {
      this.refreshedAt = now
      void this.source()?.refreshAccountUsage?.()
    }
    return hold
  }
}
