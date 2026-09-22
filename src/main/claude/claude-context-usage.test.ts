import { describe, expect, it } from 'vitest'
import {
  ClaudeContextUsageTracker,
  claudeContextUsageFromControl,
  claudeContextUsageFromTwin
} from './claude-context-usage'

// Shapes measured from Claude Code 2.1.270 / Agent SDK 0.3.251.
const CONTROL_REPORT = {
  categories: [
    { name: 'System prompt', tokens: 3_800, color: 'x' },
    { name: 'System tools (deferred)', tokens: 15_500, color: 'x', isDeferred: true },
    { name: 'Messages', tokens: 10, color: 'x' },
    { name: 'Autocompact buffer', tokens: 33_000, color: 'x' },
    { name: 'Free space', tokens: 981_400, color: 'x' }
  ],
  totalTokens: 18_600,
  maxTokens: 967_000,
  rawMaxTokens: 1_000_000,
  percentage: 2,
  gridRows: [],
  model: 'claude-fable-5-1[1m]',
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  autoCompactThreshold: 967_000,
  isAutoCompactEnabled: true
}

const TWIN = {
  model: 'claude-fable-5-1[1m]',
  total_tokens: 18_600,
  raw_max_tokens: 1_000_000,
  percentage: 2,
  categories: [
    { name: 'System prompt', tokens: 3_800, kind: 'used' },
    { name: 'System tools (deferred)', tokens: 15_500, kind: 'deferred' },
    { name: 'Free space', tokens: 981_400, kind: 'free' }
  ],
  mcp_tools: [],
  memory_files: [],
  agents: []
}

describe('claudeContextUsageFromControl', () => {
  it('maps the control response, classifying rows by the CLI names', () => {
    const usage = claudeContextUsageFromControl(CONTROL_REPORT, 42)
    expect(usage).toMatchObject({
      model: 'claude-fable-5-1[1m]',
      usedTokens: 18_600,
      windowTokens: 1_000_000,
      percentage: 2,
      autoCompactAtTokens: 967_000,
      estimated: false,
      capturedAt: 42
    })
    expect(usage?.categories.map((row) => [row.name, row.kind])).toEqual([
      ['System prompt', 'used'],
      ['System tools (deferred)', 'deferred'],
      ['Messages', 'used'],
      ['Autocompact buffer', 'buffer'],
      ['Free space', 'free']
    ])
    expect(usage?.overLimit).toBeUndefined()
  })

  it('omits the compaction threshold when auto-compaction is off', () => {
    const usage = claudeContextUsageFromControl(
      { ...CONTROL_REPORT, isAutoCompactEnabled: false },
      1
    )
    expect(usage?.autoCompactAtTokens).toBeUndefined()
  })

  it('reports an over-limit window and rejects unusable reports', () => {
    const over = claudeContextUsageFromControl(
      { ...CONTROL_REPORT, totalTokens: 1_000_500, percentage: 100 },
      1
    )
    expect(over?.overLimit).toEqual({ tokensOver: 500, kind: 'compaction_window' })
    expect(claudeContextUsageFromControl({}, 1)).toBeNull()
    expect(
      claudeContextUsageFromControl({ ...CONTROL_REPORT, rawMaxTokens: 0, maxTokens: 0 }, 1)
    ).toBeNull()
    expect(claudeContextUsageFromControl(null, 1)).toBeNull()
  })
})

describe('claudeContextUsageFromTwin', () => {
  it('maps the /context twin with the kinds the CLI assigned', () => {
    const usage = claudeContextUsageFromTwin(TWIN, 7)
    expect(usage).toMatchObject({ usedTokens: 18_600, windowTokens: 1_000_000, percentage: 2 })
    expect(usage?.categories).toEqual([
      { name: 'System prompt', tokens: 3_800, kind: 'used' },
      { name: 'System tools (deferred)', tokens: 15_500, kind: 'deferred' },
      { name: 'Free space', tokens: 981_400, kind: 'free' }
    ])
  })

  it('keeps the provider over-limit verdict and drops rows it cannot classify', () => {
    const usage = claudeContextUsageFromTwin(
      {
        ...TWIN,
        over_limit: { tokens_over: 12, kind: 'hard_limit' },
        categories: [{ name: 'Odd', tokens: 1, kind: 'mystery' }]
      },
      7
    )
    expect(usage?.overLimit).toEqual({ tokensOver: 12, kind: 'hard_limit' })
    expect(usage?.categories).toEqual([])
  })
})

describe('ClaudeContextUsageTracker', () => {
  it('asks for a capture when a turn settles and keeps the answer', async () => {
    const tracker = new ClaudeContextUsageTracker()
    expect(tracker.observe({ type: 'assistant', message: {} }, 1)).toEqual({
      changed: false,
      capture: false
    })
    expect(tracker.observe({ type: 'result', subtype: 'success' }, 2)).toEqual({
      changed: false,
      capture: true
    })
    expect(
      await tracker.capture(
        async () => CONTROL_REPORT,
        () => 3
      )
    ).toBe(true)
    expect(tracker.contextUsage?.capturedAt).toBe(3)
  })

  it('discards a capture that a newer frame overtook, and one that failed', async () => {
    const tracker = new ClaudeContextUsageTracker()
    let release: () => void = () => {}
    const pending = tracker.capture(
      () => new Promise((resolve) => (release = () => resolve(CONTROL_REPORT))),
      () => 9
    )
    tracker.observe({ type: 'user', message: {} }, 4)
    release()
    expect(await pending).toBe(false)
    expect(tracker.contextUsage).toBeUndefined()
    expect(
      await tracker.capture(
        async () => {
          throw new Error('older CLI')
        },
        () => 9
      )
    ).toBe(false)
  })

  it('takes the /context twin from an assistant frame directly', () => {
    const tracker = new ClaudeContextUsageTracker()
    const outcome = tracker.observe({ type: 'assistant', context_usage: TWIN, message: {} }, 5)
    expect(outcome.changed).toBe(true)
    expect(tracker.contextUsage?.usedTokens).toBe(18_600)
    expect(tracker.contextUsage?.capturedAt).toBe(5)
  })
})
