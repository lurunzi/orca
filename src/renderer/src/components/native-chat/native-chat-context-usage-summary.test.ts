import { describe, expect, it } from 'vitest'
import {
  summarizeEstimatedContextUsage,
  summarizeProviderContextUsage
} from './native-chat-context-usage-summary'

describe('summarizeProviderContextUsage', () => {
  it('orders rows by size and drops empty and deferred rows', () => {
    const summary = summarizeProviderContextUsage({
      model: 'claude-fable-5-1',
      usedTokens: 29_400,
      windowTokens: 200_000,
      percentage: 15,
      estimated: false,
      capturedAt: 1,
      categories: [
        { name: 'Messages', tokens: 10_200, kind: 'used' },
        { name: 'System tools (deferred)', tokens: 17_600, kind: 'deferred' },
        { name: 'Skills', tokens: 0, kind: 'used' },
        { name: 'Free space', tokens: 170_600, kind: 'free' },
        { name: 'System prompt', tokens: 3_800, kind: 'used' }
      ]
    })
    expect(summary.rows).toEqual([
      { name: 'Free space', tokens: 170_600, percentage: 85.3 },
      { name: 'Messages', tokens: 10_200, percentage: 5.1 },
      { name: 'System prompt', tokens: 3_800, percentage: 1.9 }
    ])
    expect(summary.estimated).toBe(false)
  })
})

describe('summarizeEstimatedContextUsage', () => {
  it('shows what is in use and what is free when no breakdown exists', () => {
    const summary = summarizeEstimatedContextUsage({
      usedTokens: 54_617,
      windowTokens: 200_000,
      percentage: 27,
      model: 'claude-fable-5-1',
      estimated: true,
      observedAt: null
    })
    expect(summary.rows).toEqual([
      { name: 'Free space', tokens: 145_383, percentage: 72.7 },
      { name: 'In use', tokens: 54_617, percentage: 27.3 }
    ])
    expect(summary.estimated).toBe(true)
  })
})
