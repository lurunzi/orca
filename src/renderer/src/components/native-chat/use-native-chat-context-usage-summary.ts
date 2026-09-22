import { useMemo } from 'react'
import type { NativeChatContextUsage } from '../../../../shared/native-chat-context-usage'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'
import {
  summarizeEstimatedContextUsage,
  summarizeProviderContextUsage,
  type NativeChatContextUsageSummary
} from './native-chat-context-usage-summary'

/** The ring's input for whichever lane hosts the composer: the structured
 *  session's provider report wins; a terminal session falls back to the
 *  estimate derived from its transcript. */
export function useNativeChatContextUsageSummary(
  structuredTransport: NativeChatStructuredComposerTransport | undefined,
  estimate: NativeChatContextUsage | null | undefined
): NativeChatContextUsageSummary | null {
  const report = structuredTransport?.contextUsage ?? null
  return useMemo(() => {
    if (structuredTransport) {
      return report ? summarizeProviderContextUsage(report) : null
    }
    return estimate ? summarizeEstimatedContextUsage(estimate) : null
  }, [structuredTransport, report, estimate])
}
