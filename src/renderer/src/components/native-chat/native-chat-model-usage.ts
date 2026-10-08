import type { ProviderRateLimits, RateLimitBucket } from '../../../../shared/rate-limit-types'
import type { UsagePercentageDisplay } from '../../../../shared/usage-percentage-display'
import { formatUsagePercentageLabel } from '../status-bar/usage-percentage-label'

export function antigravityModelUsageBuckets(
  usage: ProviderRateLimits | null | undefined,
  model: string
): RateLimitBucket[] {
  if (usage?.provider !== 'antigravity' || usage.status !== 'ok') {
    return []
  }
  const family = /\bgemini\b/i.test(model)
    ? 'gemini'
    : /\b(?:claude|gpt)\b/i.test(model)
      ? 'third-party'
      : null
  if (!family) {
    return []
  }
  return (usage.buckets ?? []).filter((bucket) =>
    family === 'gemini'
      ? /^Gemini Models(?:$| · )/i.test(bucket.name)
      : /^Claude and GPT models(?:$| · )/i.test(bucket.name)
  )
}

export function nativeChatModelUsageLabel(
  usage: ProviderRateLimits | null | undefined,
  model: string,
  display: UsagePercentageDisplay
): string | undefined {
  const buckets = antigravityModelUsageBuckets(usage, model)
  if (buckets.length === 0) {
    return undefined
  }
  return buckets
    .map((bucket) => {
      const window =
        bucket.windowMinutes === 300 ? '5h' : bucket.windowMinutes === 10080 ? '7d' : bucket.name
      return `${window} ${formatUsagePercentageLabel(bucket.usedPercent, display)}`
    })
    .join(' · ')
}
