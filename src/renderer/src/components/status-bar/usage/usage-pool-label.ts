import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import {
  formatRateLimitWindowChipLabel,
  formatWindowLabel
} from './rate-limit-window-localized-label'
import type {
  ProviderRateLimits,
  RateLimitBucket,
  RateLimitWindow
} from '../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import { clampUsedPercent } from '../../../../../shared/agent-usage/display/usage-percentage-display'
import {
  formatPoolGroupLabel,
  formatPoolLabel,
  formatPoolWindowName,
  isGroupedUsagePool,
  type GroupedUsagePool
} from '../../../../../shared/agent-usage/display/grouped-usage-pool'
import { WEEKLY_WINDOW_MINUTES } from '../../../../../shared/agent-usage/display/usage-provider-windows'
import { USAGE_WARNING_PERCENT } from './usage-health-tone'

/** Antigravity's default Gemini pool needs no name; its other pool reads as "Other Models". */
function formatGroupLabel(group: string, buckets: readonly RateLimitBucket[]): string {
  if (/^Gemini Models$/i.test(group)) {
    return ''
  }
  if (/^Claude and GPT models$/i.test(group)) {
    return 'Other Models'
  }
  return formatPoolGroupLabel(group, buckets)
}

function formatShortPoolWindowName(bucket: RateLimitBucket, t: Translate = translate): string {
  // Older hosts fold a groupless pool's window into its combined name.
  const legacyWindowName =
    bucket.windowName == null && !bucket.group
      ? bucket.name.split(' · ').slice(1).join(' · ')
      : undefined
  const pool = legacyWindowName ? { ...bucket, windowName: legacyWindowName } : bucket
  return formatPoolWindowName(pool, (minutes) =>
    minutes === WEEKLY_WINDOW_MINUTES
      ? t('auto.components.status.bar.StatusBar.5c938d39ac', 'wk')
      : formatWindowLabel(minutes)
  )
}

export function formatPoolRosterLabel(
  bucket: GroupedUsagePool,
  buckets: readonly RateLimitBucket[],
  t: Translate = translate
): string {
  return `${formatGroupLabel(bucket.group, buckets)} ${formatShortPoolWindowName(bucket, t)}`.trim()
}

export function formatPoolCardLabel(
  bucket: GroupedUsagePool,
  buckets: readonly RateLimitBucket[],
  t: Translate = translate
): string {
  return formatPoolLabel(bucket, buckets, (minutes) =>
    minutes === WEEKLY_WINDOW_MINUTES
      ? t('auto.components.status.bar.tooltip.252c096536', 'Weekly')
      : formatWindowLabel(minutes)
  )
}

export function formatPoolWindowLabel(
  bucket: RateLimitBucket,
  now?: number,
  t?: Translate
): string {
  const label = formatShortPoolWindowName(bucket, t)
  // Show the reset once the pool turns yellow, by consumption whatever the % display.
  if (clampUsedPercent(bucket.usedPercent) >= USAGE_WARNING_PERCENT && bucket.resetsAt != null) {
    const countdown = formatRateLimitWindowChipLabel(bucket, now)
    return label ? `${label} (${countdown})` : countdown
  }
  return label
}

export function formatPoolShortLabel(
  bucket: RateLimitBucket,
  buckets: readonly RateLimitBucket[],
  now?: number,
  t?: Translate
): string {
  // Older hosts publish only the combined name; recognise their known groups too.
  const group = bucket.group ?? bucket.name.split(' · ')[0]
  if (!bucket.group && !/^(Gemini Models|Claude and GPT models)$/i.test(group)) {
    return bucket.name
  }
  return `${formatGroupLabel(group, buckets)} ${formatPoolWindowLabel(bucket, now, t)}`.trim()
}

export function formatStatusBarSectionLabel(
  p: ProviderRateLimits,
  section: { label: string; window: RateLimitWindow },
  now?: number,
  t?: Translate
): string {
  const bucket = p.provider === 'antigravity' && p.buckets?.find((b) => b === section.window)
  if (bucket) {
    return formatPoolShortLabel(bucket, p.buckets ?? [], now, t)
  }
  return isGroupedUsagePool(section.window)
    ? formatPoolShortLabel(section.window, p.buckets ?? [], now, t)
    : section.label
}
