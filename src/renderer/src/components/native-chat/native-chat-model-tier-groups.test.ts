import { describe, expect, it } from 'vitest'
import {
  buildModelPickerRows,
  findTieredRow,
  tieredRowTargetValue
} from './native-chat-model-tier-groups'

// Shape of `agy models` output: each effort tier is its own model id.
const AGY_CHOICES = [
  { value: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
  { value: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  { value: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
  { value: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
  { value: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  { value: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' }
]

describe('buildModelPickerRows', () => {
  it('groups tier siblings and keeps singles and non-tier suffixes whole', () => {
    const rows = buildModelPickerRows(AGY_CHOICES)
    expect(rows.map((row) => (row.kind === 'tiered' ? row.baseLabel : row.choice.label))).toEqual([
      'Gemini 3.8 Flash',
      'Gemini 3.1 Pro',
      'Claude Sonnet 4.6 (Thinking)',
      'GPT-OSS 120B (Medium)'
    ])
    const flash = findTieredRow(rows, 'gemini-3.8-flash-low')
    expect(flash?.tiers.map((tier) => tier.tier)).toEqual(['high', 'medium', 'low'])
  })

  it('leaves plain model lists untouched', () => {
    const choices = [
      { value: 'opus', label: 'Opus 4.8' },
      { value: 'sonnet', label: 'Sonnet 5 (1M context)' }
    ]
    expect(buildModelPickerRows(choices).every((row) => row.kind === 'model')).toBe(true)
  })
})

describe('tieredRowTargetValue', () => {
  const rows = buildModelPickerRows(AGY_CHOICES)
  const pro = findTieredRow(rows, 'gemini-3.1-pro-low')!

  it('keeps the current tier when the target model offers it', () => {
    expect(tieredRowTargetValue(pro, 'low')).toBe('gemini-3.1-pro-low')
  })

  it('falls back to the first listed tier otherwise', () => {
    expect(tieredRowTargetValue(pro, 'medium')).toBe('gemini-3.1-pro-high')
    expect(tieredRowTargetValue(pro, null)).toBe('gemini-3.1-pro-high')
  })
})
