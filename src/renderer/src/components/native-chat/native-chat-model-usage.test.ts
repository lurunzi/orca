import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits, RateLimitBucket } from '../../../../shared/rate-limit-types'
import { antigravityModelUsageBuckets, nativeChatModelUsageLabel } from './native-chat-model-usage'

const bucket = (name: string, usedPercent: number, windowMinutes = 10080): RateLimitBucket => ({
  name,
  usedPercent,
  windowMinutes,
  resetsAt: null,
  resetDescription: null
})
const usage: ProviderRateLimits = {
  provider: 'antigravity',
  status: 'ok',
  session: null,
  weekly: null,
  error: null,
  updatedAt: 1,
  buckets: [
    bucket('Gemini Models · Weekly Limit Remaining', 25),
    bucket('Gemini Models · 5-hour Limit Remaining', 5, 300),
    bucket('Claude and GPT models', 80)
  ]
}

describe('Antigravity model quotas', () => {
  it('keeps the Gemini and third-party pools separate, including tiered model ids', () => {
    expect(antigravityModelUsageBuckets(usage, 'gemini-3.8-flash-high')).toHaveLength(2)
    expect(antigravityModelUsageBuckets(usage, 'claude-opus-thinking')[0]?.usedPercent).toBe(80)
    expect(antigravityModelUsageBuckets(usage, 'gpt-oss')[0]?.usedPercent).toBe(80)
    expect(nativeChatModelUsageLabel(usage, 'Gemini 3.8 Flash', 'remaining')).toBe(
      '7d 75% left · 5h 95% left'
    )
  })
  it('does not invent quota for unknown models, failed reads or another provider', () => {
    expect(antigravityModelUsageBuckets(usage, 'auto')).toEqual([])
    expect(antigravityModelUsageBuckets({ ...usage, status: 'error' }, 'Gemini')).toEqual([])
    expect(antigravityModelUsageBuckets({ ...usage, provider: 'gemini' }, 'Gemini')).toEqual([])
  })
})
