import type {
  AgentSessionContextUsage,
  AgentSessionContextUsageCategory
} from '../../../../shared/agent-session-wire'
import type { NativeChatContextUsage } from '../../../../shared/native-chat-context-usage'

/** What the composer ring renders, from either lane: the structured session's
 *  provider report with its breakdown, or the terminal lane's estimate, which
 *  only knows the total and so shows one used row and the free space. */
export type NativeChatContextUsageSummary = {
  usedTokens: number
  windowTokens: number
  percentage: number
  estimated: boolean
  /** Rows worth showing, largest first; zero rows and out-of-window rows are dropped. */
  rows: readonly { name: string; tokens: number; percentage: number }[]
}

function rowPercentage(tokens: number, windowTokens: number): number {
  return windowTokens > 0 ? Math.round((tokens / windowTokens) * 1000) / 10 : 0
}

function visibleRows(
  categories: readonly AgentSessionContextUsageCategory[],
  windowTokens: number
): NativeChatContextUsageSummary['rows'] {
  return categories
    .filter((row) => row.tokens > 0 && row.kind !== 'deferred')
    .map((row) => ({
      name: row.name,
      tokens: row.tokens,
      percentage: rowPercentage(row.tokens, windowTokens)
    }))
    .sort((left, right) => right.tokens - left.tokens)
}

export function summarizeProviderContextUsage(
  usage: AgentSessionContextUsage
): NativeChatContextUsageSummary {
  return {
    usedTokens: usage.usedTokens,
    windowTokens: usage.windowTokens,
    percentage: usage.percentage,
    estimated: usage.estimated,
    rows: visibleRows(usage.categories, usage.windowTokens)
  }
}

export function summarizeEstimatedContextUsage(
  usage: NativeChatContextUsage
): NativeChatContextUsageSummary {
  const free = Math.max(0, usage.windowTokens - usage.usedTokens)
  return {
    usedTokens: usage.usedTokens,
    windowTokens: usage.windowTokens,
    percentage: usage.percentage,
    estimated: true,
    rows: visibleRows(
      [
        { name: 'Free space', tokens: free, kind: 'free' },
        { name: 'In use', tokens: usage.usedTokens, kind: 'used' }
      ],
      usage.windowTokens
    )
  }
}
