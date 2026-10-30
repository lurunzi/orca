import type { ProviderRateLimits, RateLimitWindow } from '../../../../shared/rate-limit-types'
import type { StatusBarUsageMode } from '../../../../shared/status-bar-usage-mode'
import {
  CURSOR_MODELS_BUCKET_NAME,
  isCursorUsageBucket
} from '../../../../shared/cursor-usage-buckets'
import { translate } from '@/i18n/i18n'
import { formatRateLimitWindowChipLabel } from '@/lib/window-label-formatter'
import { getUsageHeadlineSection } from './UsageRosterPanel'

export type StatusBarUsageSection = {
  key: string
  window: RateLimitWindow
  label: string
  labelFirst?: boolean
}

const STATUS_BAR_BUCKET_NAMES = new Set(['Flash', 'Pro', '1.5 Pro'])

export function getStatusBarUsageSections(
  p: ProviderRateLimits | null,
  mode: StatusBarUsageMode,
  now = Date.now()
): StatusBarUsageSection[] {
  if (!p || p.status === 'idle' || p.status === 'unavailable') {
    return []
  }
  if (mode === 'compact') {
    const headline = getUsageHeadlineSection(p, now)
    return headline ? [{ key: 'headline', ...headline }] : []
  }
  if (p.buckets?.length) {
    // Antigravity pool names vary by account tier; Gemini's experimental pools stay hidden.
    const buckets = p.buckets.filter(
      (bucket) =>
        p.provider === 'antigravity' ||
        STATUS_BAR_BUCKET_NAMES.has(bucket.name) ||
        isCursorUsageBucket(bucket.name)
    )
    if (buckets.length > 0) {
      return buckets.map((bucket) => ({
        key: bucket.name,
        window: bucket,
        label:
          p.provider === 'cursor' && bucket.name === CURSOR_MODELS_BUCKET_NAME
            ? formatRateLimitWindowChipLabel(bucket, now)
            : bucket.name,
        labelFirst: !(p.provider === 'cursor' && bucket.name === CURSOR_MODELS_BUCKET_NAME)
      }))
    }
    const fallback = p.session ?? p.monthly ?? p.weekly
    return fallback
      ? [
          {
            key: 'fallback',
            window: fallback,
            label: formatRateLimitWindowChipLabel(fallback, now)
          }
        ]
      : []
  }
  return [
    p.session
      ? { key: 'session', window: p.session, label: formatRateLimitWindowChipLabel(p.session, now) }
      : null,
    p.weekly
      ? { key: 'weekly', window: p.weekly, label: formatRateLimitWindowChipLabel(p.weekly, now) }
      : null,
    p.fableWeekly
      ? {
          key: 'fableWeekly',
          window: p.fableWeekly,
          label: translate('auto.components.status.bar.StatusBar.a79c64f87e', 'Fable')
        }
      : null,
    // Monthly-only providers keep their limit inline; other plans show it in the details.
    p.monthly && !p.session && !p.weekly
      ? { key: 'monthly', window: p.monthly, label: formatRateLimitWindowChipLabel(p.monthly, now) }
      : null
  ].filter((section) => section !== null)
}
