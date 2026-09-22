// What the Claude CLI reports about its context window, in the wire's shape.
//
// Two producers feed one snapshot: the `get_context_usage` control request the
// host issues when a turn settles, and the structured twin the CLI attaches to
// the synthetic assistant message that delivers a `/context` report. Both are
// provider counts; a snapshot only says `estimated` when the CLI says so.

import type {
  AgentSessionContextUsage,
  AgentSessionContextUsageCategory
} from '../../shared/agent-session-wire'

const MAX_CATEGORIES = 64
const MAX_CATEGORY_NAME_LENGTH = 80

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function categoryName(value: unknown): string | null {
  const name = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : ''
  return name.length > 0 && name.length <= MAX_CATEGORY_NAME_LENGTH ? name : null
}

function categoryKind(value: unknown): AgentSessionContextUsageCategory['kind'] | null {
  return value === 'used' || value === 'free' || value === 'buffer' || value === 'deferred'
    ? value
    : null
}

/** The control response names no kinds; the CLI's own row names decide. */
function kindFromControlRow(
  name: string,
  deferred: boolean
): AgentSessionContextUsageCategory['kind'] {
  if (deferred) {
    return 'deferred'
  }
  const lower = name.toLowerCase()
  if (lower === 'free space') {
    return 'free'
  }
  return lower.endsWith('compact buffer') ? 'buffer' : 'used'
}

function categories(
  rows: readonly AgentSessionContextUsageCategory[]
): AgentSessionContextUsageCategory[] {
  return rows.slice(0, MAX_CATEGORIES)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function overLimitKind(value: unknown): 'hard_limit' | 'compaction_window' | null {
  return value === 'hard_limit' || value === 'compaction_window' ? value : null
}

/** The `/context` twin on an assistant frame; null when the frame carries none it can trust. */
export function claudeContextUsageFromTwin(
  value: unknown,
  capturedAt: number
): AgentSessionContextUsage | null {
  if (!isRecord(value)) {
    return null
  }
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  const usedTokens = count(value.total_tokens)
  const windowTokens = count(value.raw_max_tokens)
  if (!model || usedTokens === null || windowTokens === null || windowTokens === 0) {
    return null
  }
  const categoryRows: AgentSessionContextUsageCategory[] = []
  for (const entry of rows(value.categories)) {
    const name = categoryName(entry.name)
    const tokens = count(entry.tokens)
    const kind = categoryKind(entry.kind)
    if (name && tokens !== null && kind) {
      categoryRows.push({ name, tokens, kind })
    }
  }
  const over = isRecord(value.over_limit) ? value.over_limit : null
  const tokensOver = count(over?.tokens_over)
  const kind = overLimitKind(over?.kind)
  return {
    model,
    usedTokens,
    windowTokens,
    percentage: count(value.percentage) ?? Math.round((usedTokens / windowTokens) * 100),
    ...(tokensOver !== null && kind ? { overLimit: { tokensOver, kind } } : {}),
    estimated: false,
    categories: categories(categoryRows),
    capturedAt
  }
}

/** The `get_context_usage` control response; null when it is unusable. */
export function claudeContextUsageFromControl(
  value: unknown,
  capturedAt: number
): AgentSessionContextUsage | null {
  if (!isRecord(value)) {
    return null
  }
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  const usedTokens = count(value.totalTokens)
  const windowTokens = count(value.rawMaxTokens) ?? count(value.maxTokens)
  if (!model || usedTokens === null || windowTokens === null || windowTokens === 0) {
    return null
  }
  const categoryRows: AgentSessionContextUsageCategory[] = []
  for (const entry of rows(value.categories)) {
    const name = categoryName(entry.name)
    const tokens = count(entry.tokens)
    if (name && tokens !== null) {
      categoryRows.push({ name, tokens, kind: kindFromControlRow(name, entry.isDeferred === true) })
    }
  }
  const autoCompactAtTokens =
    value.isAutoCompactEnabled === true ? count(value.autoCompactThreshold) : null
  return {
    model,
    usedTokens,
    windowTokens,
    percentage: count(value.percentage) ?? Math.round((usedTokens / windowTokens) * 100),
    ...(usedTokens > windowTokens
      ? { overLimit: { tokensOver: usedTokens - windowTokens, kind: 'compaction_window' as const } }
      : {}),
    ...(autoCompactAtTokens !== null ? { autoCompactAtTokens } : {}),
    estimated: false,
    categories: categories(categoryRows),
    capturedAt
  }
}

/** Frames after which the report the host holds no longer describes the window. */
function invalidatesContextUsage(message: Record<string, unknown>): boolean {
  return message.type === 'assistant' || message.type === 'user' || message.type === 'stream_event'
}

/** Frames after which the CLI can answer for the settled window. */
function settlesContextUsage(message: Record<string, unknown>): boolean {
  return (
    message.type === 'result' ||
    (message.type === 'system' && message.subtype === 'compact_boundary')
  )
}

/** Per-session report, replaced by later reports and never rolled back to an
 *  older one: a capture that started before newer frames arrived is discarded. */
export class ClaudeContextUsageTracker {
  private snapshot: AgentSessionContextUsage | undefined
  private revision = 0

  get contextUsage(): AgentSessionContextUsage | undefined {
    return this.snapshot
  }

  /** Observe one provider frame. Returns what the caller should do next. */
  observe(message: Record<string, unknown>, now: number): { changed: boolean; capture: boolean } {
    if (invalidatesContextUsage(message)) {
      this.revision += 1
    }
    let changed = false
    if (message.type === 'assistant' && 'context_usage' in message) {
      const twin = claudeContextUsageFromTwin(message.context_usage, now)
      if (twin) {
        this.snapshot = twin
        changed = true
      }
    }
    return { changed, capture: settlesContextUsage(message) }
  }

  /** Reads through `read` and keeps the result only if no frame moved the window since. */
  async capture(read: () => Promise<unknown>, now: () => number): Promise<boolean> {
    const revision = this.revision
    let report: unknown
    try {
      report = await read()
    } catch {
      return false
    }
    if (revision !== this.revision) {
      return false
    }
    const snapshot = claudeContextUsageFromControl(report, now())
    if (!snapshot) {
      return false
    }
    this.snapshot = snapshot
    return true
  }
}
