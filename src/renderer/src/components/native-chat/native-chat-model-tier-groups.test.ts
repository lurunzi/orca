import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCursorModels } from '../../../../shared/commit-message-model-parsers'
import {
  buildModelPickerRows,
  findTieredRow,
  projectModelTierOptions
} from './native-chat-model-tier-groups'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat/input/native-chat-session-options'

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

  it('groups Cursor speed and thinking variants under the same model', () => {
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
      'Opus 4.6 Thinking'
    ])
    expect(findTieredRow(rows, 'claude-opus-5-high-fast')?.tiers.map(({ value }) => value)).toEqual(
      [
        'claude-opus-5-high',
        'claude-opus-5-low',
        'claude-opus-5-high-fast',
        'claude-opus-5-low-fast',
        'claude-opus-5-thinking-high',
        'claude-opus-5-thinking-xhigh'
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

  it('preserves every current Cursor CLI variant and only dispatches listed ids', () => {
    const choices = parseCursorModels(
      readFileSync(join(__dirname, '__fixtures__/cursor-model-list.txt'), 'utf8')
    ).map(({ id, label }) => ({ value: id, label }))
    const listed = new Set(choices.map((choice) => choice.value))
    expect(choices.length).toBeGreaterThan(200)
    for (const choice of choices) {
      const result = project(choice.value, choices)
      const model = result.snapshot[0]
      if (model.kind.type !== 'select') {
        throw new Error('Expected model select')
      }
      expect(model.kind.choices.filter((row) => row.value === choice.value)).toHaveLength(1)
      expect(model.kind.choices.length).toBeLessThan(50)
      const effort = result.snapshot.find((option) => option.id === 'effort')
      if (effort?.kind.type === 'select') {
        for (const tier of effort.kind.choices) {
          expect(listed.has(tier.value)).toBe(true)
        }
      }
      for (const value of Object.values({
        ...result.speedModelValues,
        ...result.thinkingModelValues
      })) {
        expect(listed.has(value)).toBe(true)
      }
    }
  })

  it('orders effort and maps Thinking without changing the effort or speed', () => {
    const choices = [
      { value: 'claude-opus-5-thinking-high-fast', label: 'Claude Opus 5 1M Thinking Fast' },
      { value: 'claude-opus-5-high-fast', label: 'Claude Opus 5 1M Fast' },
      { value: 'claude-opus-5-thinking-low-fast', label: 'Claude Opus 5 1M Low Thinking Fast' },
      {
        value: 'claude-opus-5-thinking-xhigh-fast',
        label: 'Claude Opus 5 1M Extra High Thinking Fast'
      }
    ]
    const result = project(choices[0].value, choices)
    expect(result.snapshot[0].kind).toMatchObject({ choices: [{ label: 'Claude Opus 5 1M' }] })
    expect(result.thinkingModelValues).toEqual({ true: choices[0].value, false: choices[1].value })
    expect(result.snapshot.find((option) => option.id === 'effort')?.kind).toMatchObject({
      choices: [{ label: 'Low' }, { label: 'High' }, { label: 'Extra high' }]
    })
    const unmatched = project(choices[3].value, choices)
    expect(unmatched.thinkingModelValues).toBeUndefined()
    expect(unmatched.snapshot.find((option) => option.id === 'thinking')).toMatchObject({
      settable: false,
      kind: { type: 'boolean', currentValue: true }
    })
  })

  it('keeps effort and speed when the next model has no Thinking variant', () => {
    const result = project('claude-opus-5-thinking-high-fast', [
      { value: 'claude-opus-5-thinking-high-fast', label: 'Claude Opus 5 Thinking Fast' },
      { value: 'claude-opus-5-high-fast', label: 'Claude Opus 5 Fast' },
      { value: 'grok-4.7-low-fast', label: 'Grok 4.7 Low Fast' },
      { value: 'grok-4.7-high-fast', label: 'Grok 4.7 High Fast' }
    ])
    expect(result.snapshot[0].kind).toMatchObject({
      choices: [{ value: 'claude-opus-5-thinking-high-fast' }, { value: 'grok-4.7-high-fast' }]
    })
  })

  it('handles Thinking-only suffixes and older effort-before-thinking ids', () => {
    for (const choices of [
      [
        { value: 'claude-4-sonnet', label: 'Claude Sonnet 4' },
        { value: 'claude-4-sonnet-thinking', label: 'Claude Sonnet 4 Thinking' }
      ],
      [
        { value: 'claude-4.6-sonnet-medium', label: 'Claude Sonnet 4.6 1M' },
        { value: 'claude-4.6-sonnet-medium-thinking', label: 'Claude Sonnet 4.6 1M Thinking' }
      ]
    ]) {
      const result = project(choices[1].value, choices)
      expect(result.thinkingModelValues).toEqual({
        false: choices[0].value,
        true: choices[1].value
      })
      expect(result.snapshot.find((option) => option.id === 'effort')).toBeUndefined()
    }
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
