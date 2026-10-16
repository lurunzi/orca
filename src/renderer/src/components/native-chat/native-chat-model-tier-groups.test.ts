import { describe, expect, it } from 'vitest'
import {
  buildModelPickerRows,
  findTieredRow,
  projectModelTierOptions
} from './native-chat-model-tier-groups'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'

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

it('leaves a native effort option and its model values unchanged', () => {
  const snapshot: SessionOptionDescriptor[] = [
    {
      id: 'model',
      label: 'Model',
      category: 'model',
      valueSource: 'reported',
      transport: 'agent-session',
      settable: true,
      kind: { type: 'select', currentValue: AGY_CHOICES[0].value, choices: AGY_CHOICES }
    },
    {
      id: 'effort',
      label: 'Effort',
      category: 'thought_level',
      valueSource: 'reported',
      transport: 'agent-session',
      settable: true,
      kind: {
        type: 'select',
        currentValue: 'medium',
        choices: [{ value: 'medium', label: 'Medium' }]
      }
    }
  ]
  expect(projectModelTierOptions(snapshot)).toEqual({ snapshot, tierModelId: null })
  expect(projectModelTierOptions(snapshot).snapshot).toBe(snapshot)
})

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

  it('groups Cursor speeds together while keeping thinking variants separate', () => {
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
      'Claude Opus 5 1M Thinking',
      'Opus 4.6 Thinking'
    ])
    expect(findTieredRow(rows, 'claude-opus-5-high-fast')?.tiers.map(({ value }) => value)).toEqual(
      [
        'claude-opus-5-high',
        'claude-opus-5-low',
        'claude-opus-5-high-fast',
        'claude-opus-5-low-fast'
      ]
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

  it('keeps an extra-high suffix in the same model group', () => {
    const rows = buildModelPickerRows([
      { value: 'gpt-5.5-high', label: 'GPT 5.5 High' },
      { value: 'gpt-5.5-extra-high', label: 'GPT 5.5 Extra High' },
      { value: 'gpt-5.5-extra-high-fast', label: 'GPT 5.5 Extra High Fast' }
    ])
    expect(rows).toHaveLength(1)
    expect(findTieredRow(rows, 'gpt-5.5-extra-high-fast')?.tiers.map(({ tier }) => tier)).toEqual([
      'high',
      'xhigh',
      'xhigh'
    ])
  })
})

describe('model effort and speed projection', () => {
  function project(
    currentValue: string,
    choices = [
      { value: 'grok-4.7-low', label: 'Grok 4.7 Low' },
      { value: 'grok-4.7-low-fast', label: 'Grok 4.7 Low Fast\u200b\u200b' },
      { value: 'grok-4.7-high', label: 'Grok 4.7 High' },
      { value: 'grok-4.7-high-fast', label: 'Grok 4.7 High Fast' }
    ]
  ) {
    return projectModelTierOptions([
      {
        id: 'model',
        label: 'Model',
        category: 'model',
        valueSource: 'reported',
        transport: 'catalog',
        settable: true,
        kind: { type: 'select', currentValue, choices }
      }
    ])
  }

  it('keeps Fast selected and changes effort within the same speed', () => {
    const result = project('grok-4.7-high-fast')
    expect(result.snapshot[0].kind).toMatchObject({
      currentValue: 'grok-4.7-high-fast',
      choices: [{ value: 'grok-4.7-high-fast', label: 'Grok 4.7' }]
    })
    expect(result.snapshot.find((option) => option.id === 'effort')?.kind).toMatchObject({
      choices: [
        { value: 'grok-4.7-low-fast', label: 'Low' },
        { value: 'grok-4.7-high-fast', label: 'High' }
      ]
    })
    expect(result.snapshot.find((option) => option.id === 'serviceTier')?.kind).toEqual({
      type: 'select',
      currentValue: 'fast',
      choices: [
        { value: 'default', label: 'Standard' },
        { value: 'fast', label: 'Fast' }
      ]
    })
    expect(result.speedModelValues).toEqual({
      default: 'grok-4.7-high',
      fast: 'grok-4.7-high-fast'
    })
  })

  it('offers speed without a made-up effort for Composer', () => {
    const result = project('composer-2.5-fast', [
      { value: 'composer-2.5', label: 'Composer 2.5' },
      { value: 'composer-2.5-fast', label: 'Composer 2.5 Fast' }
    ])
    expect(result.snapshot.map((option) => option.id)).toEqual(['model', 'serviceTier'])
    expect(result.speedModelValues).toEqual({ default: 'composer-2.5', fast: 'composer-2.5-fast' })
  })

  it('does not invent a Fast variant for an effort absent from the listing', () => {
    const result = project('grok-4.7-high', [
      { value: 'grok-4.7-low', label: 'Grok 4.7 Low' },
      { value: 'grok-4.7-low-fast', label: 'Grok 4.7 Low Fast' },
      { value: 'grok-4.7-high', label: 'Grok 4.7 High' }
    ])
    expect(result.speedModelValues).toBeUndefined()
    expect(result.snapshot.find((option) => option.id === 'serviceTier')).toBeUndefined()
  })
})
