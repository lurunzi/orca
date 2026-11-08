import type {
  ExtraUsageBalance,
  ProviderRateLimits,
  RateLimitWindow
} from '../../shared/rate-limit-types'
import type { AgentSessionUsageLimit } from '../../shared/agent-session/failures/agent-session-usage-limit'

/** Providers round a drained pool's remaining fraction; this close to full is used up. */
const USED_UP_PERCENT = 99.5

/** What the provider last said about the account's room to work. */
export type UsageLimitAccountReading = {
  /** When the provider last answered. */
  checkedAt: number
  /** A plan window is used up and no overage balance can carry the next turn. */
  exhausted: boolean
  /** Latest reset among the used-up windows; null when one of them has no known reset. */
  resetsAt: number | null
  /** Known resets of every used-up pool, plan windows and model buckets alike. */
  usedUpResets: number[]
}

function overageCarriesTurns(extra: ExtraUsageBalance | null | undefined): boolean {
  if (!extra?.enabled) {
    return false
  }
  if (extra.unit === 'credits') {
    return extra.unlimited || extra.balance > 0
  }
  return extra.spentPercent === null || extra.spentPercent < 100
}

const usedUp = (window: RateLimitWindow | null | undefined): window is RateLimitWindow =>
  window != null && window.usedPercent >= USED_UP_PERCENT

/** Null when Orca has no usable reading, so the caller falls back to the agent's own reset time.
 *  `pooled` providers (Cursor, Antigravity) meter models in separate pools, so one used-up pool
 *  never holds every chat; their cuts already carry that pool's reset. */
export function readUsageLimitAccountReading(
  limits: ProviderRateLimits | null | undefined,
  { pooled = false }: { pooled?: boolean } = {}
): UsageLimitAccountReading | null {
  if (
    !limits ||
    (limits.status !== 'ok' && limits.status !== 'fetching') ||
    !Number.isFinite(limits.updatedAt) ||
    limits.updatedAt <= 0
  ) {
    return null
  }
  // Model-specific windows (Fable weekly) stay out: they block only some chats on the account.
  const used = [limits.session, limits.weekly, limits.monthly].filter(usedUp)
  const exhausted = !pooled && used.length > 0 && !overageCarriesTurns(limits.extraUsage)
  const resets = used.map((window) => window.resetsAt)
  const pools = [...used, ...(limits.buckets ?? []).filter(usedUp)]
  return {
    checkedAt: limits.updatedAt,
    exhausted,
    usedUpResets: pools
      .map((window) => window.resetsAt)
      .filter((at): at is number => at !== null && Number.isFinite(at)),
    resetsAt:
      exhausted && resets.every((at): at is number => at !== null && Number.isFinite(at))
        ? Math.max(...resets)
        : null
  }
}

/** A turn that failed without saying why hit a limit when a reading taken after it shows a
 *  used-up pool; the earliest such reset is when the chat can most likely go on. */
export function usageLimitFromAccountReading(
  reading: UsageLimitAccountReading | null,
  failedAt: number
): AgentSessionUsageLimit | null {
  if (!reading || reading.checkedAt < failedAt) {
    return null
  }
  const upcoming = reading.usedUpResets.filter((at) => at > reading.checkedAt)
  return upcoming.length > 0 ? { resetsAt: Math.min(...upcoming) } : null
}
