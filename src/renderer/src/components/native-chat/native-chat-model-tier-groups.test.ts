import { describe, expect, it } from 'vitest'
import { buildModelPickerRows, findTieredRow } from './native-chat-model-tier-groups'

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

  it('groups Cursor id suffixes even when display names omit the effort', () => {
    const rows = buildModelPickerRows([
      { value: 'gpt-5.3-codex', label: 'Codex 5.3' },
      { value: 'gpt-5.3-codex-low', label: 'Codex 5.3 Low' },
      { value: 'gpt-5.3-codex-high', label: 'Codex 5.3 High' },
      { value: 'gpt-5.3-codex-xhigh', label: 'Codex 5.3 Extra High' },
      { value: 'claude-opus-5-5-medium', label: 'Claude Opus 5.5 1M' },
      { value: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 1M High' },
      { value: 'auto', label: 'Auto' }
    ])
    expect(rows.map((row) => (row.kind === 'tiered' ? row.baseLabel : row.choice.label))).toEqual([
      'Codex 5.3',
      'Claude Opus 5.5 1M',
      'Auto'
    ])
    expect(findTieredRow(rows, 'gpt-5.3-codex')?.tiers.map(({ tier }) => tier)).toEqual([
      'default',
      'low',
      'high',
      'xhigh'
    ])
    expect(findTieredRow(rows, 'claude-opus-5-5-medium')?.tiers[0]).toMatchObject({
      value: 'claude-opus-5-5-medium',
      tier: 'medium'
    })
  })

  it('keeps Cursor fast and thinking variants separate while grouping their efforts', () => {
    const rows = buildModelPickerRows([
      { value: 'claude-opus-5-high', label: 'Claude Opus 5 1M' },
      { value: 'claude-opus-5-low', label: 'Claude Opus 5 1M Low' },
      { value: 'claude-opus-5-high-fast', label: 'Claude Opus 5 1M Fast' },
      { value: 'claude-opus-5-low-fast', label: 'Claude Opus 5 1M Low Fast' },
      { value: 'claude-opus-5-thinking-high', label: 'Claude Opus 5 1M Thinking' },
      { value: 'claude-opus-5-thinking-xhigh', label: 'Claude Opus 5 1M Extra High Thinking' },
      { value: 'claude-4.6-opus-high-thinking', label: 'Opus 4.6 High Thinking' },
      { value: 'claude-4.6-opus-max-thinking', label: 'Opus 4.6 Max Thinking' }
    ])
    expect(rows.map((row) => (row.kind === 'tiered' ? row.baseLabel : row.choice.label))).toEqual([
      'Claude Opus 5 1M',
      'Claude Opus 5 1M Fast',
      'Claude Opus 5 1M Thinking',
      'Opus 4.6 Thinking'
    ])
    expect(findTieredRow(rows, 'claude-opus-5-high-fast')?.tiers.map(({ value }) => value)).toEqual(
      ['claude-opus-5-high-fast', 'claude-opus-5-low-fast']
    )
  })

  it('keeps unrelated ids separate even when their display names coincide', () => {
    const rows = buildModelPickerRows([
      { value: 'one-low', label: 'Shared Low' },
      { value: 'one-high', label: 'Shared High' },
      { value: 'two-low', label: 'Shared Low' },
      { value: 'two-high', label: 'Shared High' }
    ])
    expect(rows).toHaveLength(2)
    expect(findTieredRow(rows, 'one-low')?.tiers.map(({ value }) => value)).toEqual([
      'one-low',
      'one-high'
    ])
  })
})
