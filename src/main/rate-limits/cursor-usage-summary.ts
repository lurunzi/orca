import { z } from 'zod'
import type { RateLimitWindow } from '../../shared/rate-limit-types'

const nonnegative = z.number().finite().nonnegative()
const budget = z.object({ used: nonnegative.optional(), limit: nonnegative.nullish() })
const summarySchema = z.object({
  billingCycleStart: z.string().optional(),
  billingCycleEnd: z.string().optional(),
  membershipType: z.string().optional(),
  individualUsage: z
    .object({
      plan: budget
        .extend({ totalPercentUsed: nonnegative.optional(), enabled: z.boolean().optional() })
        .nullish(),
      overall: budget.nullish()
    })
    .nullish()
})

// Cursor percentages are already 0–100; used/limit cents omit bonus usage on some plans.
export function parseCursorUsageSummary(value: unknown): {
  monthly: RateLimitWindow
  planType: string | null
} | null {
  const parsed = summarySchema.safeParse(value)
  if (!parsed.success) {
    return null
  }
  const summary = parsed.data
  const plan = summary.individualUsage?.plan
  const selected = plan?.enabled === false ? null : plan
  const allocation = selected ?? summary.individualUsage?.overall
  const percent =
    selected?.totalPercentUsed ??
    (allocation?.used !== undefined && allocation.limit != null && allocation.limit > 0
      ? (allocation.used / allocation.limit) * 100
      : null)
  if (percent === null || !Number.isFinite(percent)) {
    return null
  }
  const start = Date.parse(summary.billingCycleStart ?? '')
  const end = Date.parse(summary.billingCycleEnd ?? '')
  return {
    monthly: {
      usedPercent: Math.min(100, percent),
      windowMinutes:
        Number.isFinite(start) && Number.isFinite(end) && end > start
          ? Math.round((end - start) / 60_000)
          : 43_200,
      resetsAt: Number.isFinite(end) ? end : null,
      resetDescription: null
    },
    planType: summary.membershipType ?? null
  }
}
