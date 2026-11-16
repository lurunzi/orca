import type { ProviderRateLimits } from '../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import { formatResetCreditExpiry } from '../usage/provider-usage-panel'
import type { Translate } from '../../../i18n/use-translate'

export function getCodexResetProjection(
  codex: ProviderRateLimits | null,
  hasActiveRuntimeEnvironment: boolean,
  t?: Translate
): {
  resetCreditCount: number | null
  resetCreditExpiry: string | null
  canRedeemReset: boolean
  redeemResetUnavailable: boolean
} {
  const resetCreditCount = codex?.rateLimitResetCredits?.availableCount ?? null
  const hasResetCredits = resetCreditCount !== null && resetCreditCount > 0
  const resetCreditExpiry =
    resetCreditCount !== null
      ? formatResetCreditExpiry(codex?.rateLimitResetCredits?.nextExpiresAt, resetCreditCount, t)
      : null
  return {
    resetCreditCount,
    resetCreditExpiry,
    // Why: reset credits redeem against the desktop's own Codex login, not a remote account owner's.
    canRedeemReset: !hasActiveRuntimeEnvironment && hasResetCredits,
    redeemResetUnavailable: hasActiveRuntimeEnvironment && hasResetCredits
  }
}
