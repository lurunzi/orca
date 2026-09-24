import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import { clearNativeChatSessionOptionCacheForTests } from './native-chat-session-option-cache'
import { createNativeChatPtySessionOptions } from './native-chat-pty-session-options'

const AGY_MODELS_STDOUT = [
  'Fetching available models...',
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)'
].join('\n')

const discoveredModels =
  getAgentSessionOptionCatalog('antigravity')!.listModels!.parse(AGY_MODELS_STDOUT)

describe('Antigravity model picker', () => {
  beforeEach(() => clearNativeChatSessionOptionCacheForTests())

  it('parses `agy models` into catalog choices', () => {
    expect(discoveredModels).toEqual([
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', options: [] },
      { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)', options: [] }
    ])
  })

  it('lists discovered models and switches with `/model <slug>` instead of the TUI picker', async () => {
    const dispatchCommand = vi.fn().mockResolvedValue(undefined)
    const onAgentPicker = vi.fn()
    const surface = createNativeChatPtySessionOptions({
      agent: 'antigravity',
      scopeKey: 'antigravity-model-dropdown',
      initialModels: discoveredModels,
      mode: 'live',
      dispatchCommand,
      onAgentPicker
    })!
    const [model] = surface.getSnapshot()
    expect(model).toMatchObject({
      id: 'model',
      settable: true,
      kind: {
        type: 'select',
        choices: [
          { value: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
          { value: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' }
        ]
      }
    })
    expect(model.action).toBeUndefined()

    await surface.setOption('model', 'claude-opus-4-6-thinking')
    expect(dispatchCommand).toHaveBeenCalledExactlyOnceWith('/model claude-opus-4-6-thinking')
    expect(onAgentPicker).not.toHaveBeenCalled()
    expect(surface.getSnapshot()[0]).toMatchObject({
      kind: { currentValue: 'claude-opus-4-6-thinking' }
    })
  })

  it('offers discovered models as launch choices before the agent starts', () => {
    const surface = createNativeChatPtySessionOptions({
      agent: 'antigravity',
      scopeKey: 'antigravity-draft-picker',
      initialModels: discoveredModels,
      mode: 'draft',
      dispatchCommand: vi.fn()
    })!
    expect(surface.getSnapshot()[0]).toMatchObject({ id: 'model', settable: true })
  })

  it('shows no picker until the account model list arrives', () => {
    const surface = createNativeChatPtySessionOptions({
      agent: 'antigravity',
      scopeKey: 'antigravity-no-models',
      initialModels: [],
      mode: 'live',
      dispatchCommand: vi.fn()
    })!
    expect(surface.getSnapshot()).toEqual([])
  })
})
