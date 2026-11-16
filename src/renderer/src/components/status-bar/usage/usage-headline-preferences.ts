import type { ProviderRateLimits } from '../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import { clampUsedPercent } from '../../../../../shared/agent-usage/display/usage-percentage-display'
import { formatRateLimitWindowChipLabel } from './rate-limit-window-localized-label'
import type { UsageSection } from './usage-headline-sections'

const WEEKLY_WINDOW_MINUTES = 10_080

/** Fork: equal consumption prefers the weekly window, which stays limited longest. */
export function isTighterUsageSection(candidate: UsageSection, current: UsageSection): boolean {
  const difference =
    clampUsedPercent(candidate.window.usedPercent) - clampUsedPercent(current.window.usedPercent)
  return (
    difference > 0 ||
    (difference === 0 &&
      candidate.window.windowMinutes === WEEKLY_WINDOW_MINUTES &&
      current.window.windowMinutes !== WEEKLY_WINDOW_MINUTES)
  )
}

/**
 * Fork: the dense status bar labels its headline with the reset countdown on the bar's clock.
 * Cursor always does, whichever window leads; named pools, Fable and ZCode MCP keep their names.
 */
export function withStatusBarHeadlineCountdown(
  p: ProviderRateLimits,
  section: UsageSection,
  now: number
): UsageSection {
  const keepsName =
    p.provider !== 'cursor' &&
    (section.window === p.fableWeekly ||
      (p.provider === 'zcode' && section.window === p.monthly) ||
      Boolean(p.buckets?.some((bucket) => bucket.name === section.label)))
  return keepsName
    ? section
    : { ...section, label: formatRateLimitWindowChipLabel(section.window, now) }
}
