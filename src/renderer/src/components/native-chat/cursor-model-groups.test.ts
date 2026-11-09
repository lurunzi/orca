import { describe, expect, it } from 'vitest'
import {
  extractModelVersion,
  getModelVariantSuffix,
  getModelVendorFamily,
  groupCursorModels,
  isCursorModelId
} from './cursor-model-groups'

describe('isCursorModelId', () => {
  it('identifies Cursor and Grok family ids', () => {
    expect(isCursorModelId('composer-2.5')).toBe(true)
    expect(isCursorModelId('cursor-grok-4.6')).toBe(true)
    expect(isCursorModelId('grok-4.7')).toBe(true)
    expect(isCursorModelId('cursor-fast')).toBe(true)
    expect(isCursorModelId('claude-opus-5-5')).toBe(false)
    expect(isCursorModelId('gpt-5.6-sol')).toBe(false)
    expect(isCursorModelId('gemini-4-argon')).toBe(false)
    expect(isCursorModelId('auto')).toBe(false)
  })
})

describe('getModelVendorFamily', () => {
  it('extracts vendor families for known and custom models', () => {
    expect(getModelVendorFamily('claude-opus-5-5-medium')).toBe('claude-opus')
    expect(getModelVendorFamily('claude-4.6-opus')).toBe('claude-opus')
    expect(getModelVendorFamily('claude-sonnet-5-5')).toBe('claude-sonnet')
    expect(getModelVendorFamily('claude-fable-5-1')).toBe('claude-fable')
    expect(getModelVendorFamily('claude-haiku-5-5')).toBe('claude-haiku')
    expect(getModelVendorFamily('gemini-4-argon')).toBe('gemini')
    expect(getModelVendorFamily('gemini-3.8-flash')).toBe('gemini')
    expect(getModelVendorFamily('gpt-5.6-sol')).toBe('gpt')
    expect(getModelVendorFamily('gpt-5.3-codex')).toBe('gpt')
    expect(getModelVendorFamily('kimi-k3')).toBe('kimi')
    expect(getModelVendorFamily('glm-5.2')).toBe('glm')
  })
})

describe('getModelVariantSuffix', () => {
  it('formats effort and speed suffixes', () => {
    expect(getModelVariantSuffix('grok-4.7-high-fast')).toBe('High Fast')
    expect(getModelVariantSuffix('cursor-grok-4.6-high')).toBe('High')
    expect(getModelVariantSuffix('composer-2.5-fast')).toBe('Fast')
    expect(getModelVariantSuffix('claude-opus-5-5-medium')).toBe('Medium')
    expect(getModelVariantSuffix('gpt-5.6-sol-xhigh-fast')).toBe('Extra high Fast')
    expect(getModelVariantSuffix('auto')).toBeNull()
    expect(getModelVariantSuffix('gpt-5.2')).toBeNull()
  })
})

describe('extractModelVersion', () => {
  it('parses major and minor versions from id or label', () => {
    expect(extractModelVersion({ value: 'claude-opus-5-5', label: 'Claude Opus 5.5' })).toEqual({
      major: 5,
      minor: 5
    })
    expect(extractModelVersion({ value: 'claude-opus-5', label: 'Claude Opus 5' })).toEqual({
      major: 5,
      minor: 0
    })
    expect(extractModelVersion({ value: 'claude-opus-4-8', label: 'Claude Opus 4.8' })).toEqual({
      major: 4,
      minor: 8
    })
    expect(extractModelVersion({ value: 'gemini-4-argon', label: 'Gemini 4 Argon' })).toEqual({
      major: 4,
      minor: 0
    })
    expect(extractModelVersion({ value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' })).toEqual({
      major: 3,
      minor: 8
    })
  })
})

describe('groupCursorModels', () => {
  const choices = [
    { value: 'auto', label: 'Auto' },
    { value: 'grok-4.7-high-fast', label: 'Grok 4.7' },
    { value: 'cursor-grok-4.6-high', label: 'Grok 4.6' },
    { value: 'composer-2.5-fast', label: 'Composer 2.5' },
    { value: 'claude-opus-5-5-medium', label: 'Claude Opus 5.5' },
    { value: 'claude-opus-4-8-high', label: 'Claude Opus 4.8' },
    { value: 'gemini-4-argon-medium', label: 'Gemini 4 Argon' },
    { value: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash' },
    { value: 'gpt-5.6-sol-medium', label: 'GPT-5.6 Sol' },
    { value: 'gpt-5.2-high', label: 'GPT-5.2' },
    { value: 'claude-fable-5-1-high', label: 'Claude Fable 5.1' }
  ]

  it('groups choices into Auto, Cursor Models, Other Models, and More Models', () => {
    const groups = groupCursorModels(choices)
    expect(groups.autoModel?.value).toBe('auto')
    expect(groups.cursorModels.map((c) => c.label)).toEqual([
      'Grok 4.7',
      'Grok 4.6',
      'Composer 2.5'
    ])
    expect(groups.otherModels.map((c) => c.label)).toEqual([
      'Claude Opus 5.5',
      'Gemini 4 Argon',
      'GPT-5.6 Sol',
      'Claude Fable 5.1'
    ])
    expect(groups.moreModels.map((c) => c.label)).toEqual([
      'Claude Opus 4.8',
      'Gemini 3.8 Flash',
      'GPT-5.2'
    ])
  })

  it('keeps the currently selected model visible in the main list even if it is older', () => {
    const groups = groupCursorModels(choices, 'gpt-5.2-high')
    expect(groups.otherModels.map((c) => c.label)).toContain('GPT-5.2')
    expect(groups.moreModels.map((c) => c.label)).not.toContain('GPT-5.2')
  })
})
