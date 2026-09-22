import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearNativeChatSessionOptionCacheForTests } from './native-chat-session-option-cache'
import { createNativeChatPtySessionOptions } from './native-chat-pty-session-options'

describe('Antigravity model picker', () => {
  beforeEach(() => clearNativeChatSessionOptionCacheForTests())

  it('keeps the live picker reachable without a model catalog or a reported model', async () => {
    const dispatchCommand = vi.fn().mockResolvedValue(undefined)
    const onAgentPicker = vi.fn()
    const surface = createNativeChatPtySessionOptions({
      agent: 'antigravity',
      scopeKey: 'antigravity-model-picker',
      initialModels: [],
      mode: 'live',
      dispatchCommand,
      onAgentPicker
    })!
    const expected = {
      id: 'model',
      valueSource: 'unknown',
      settable: true,
      kind: { type: 'select', choices: [] },
      action: { type: 'agent-picker' }
    }
    expect(surface.getSnapshot()).toEqual([expect.objectContaining(expected)])
    await surface.invokeAction('model')
    expect(dispatchCommand).toHaveBeenCalledExactlyOnceWith('/model')
    expect(onAgentPicker).toHaveBeenCalledOnce()
    expect(surface.getSnapshot()).toEqual([expect.objectContaining(expected)])
  })

  it('does not offer an empty model list before the agent starts', () => {
    const surface = createNativeChatPtySessionOptions({
      agent: 'antigravity',
      scopeKey: 'antigravity-draft-picker',
      initialModels: [],
      mode: 'draft',
      dispatchCommand: vi.fn()
    })!
    expect(surface.getSnapshot()).toEqual([])
  })

  it('retains the picker after a reported model is cleared by opening it', async () => {
    const surface = createNativeChatPtySessionOptions({
      agent: 'antigravity',
      scopeKey: 'antigravity-reported-picker',
      initialModels: [],
      mode: 'live',
      reportedValues: { model: 'account-model' },
      dispatchCommand: vi.fn().mockResolvedValue(undefined)
    })!
    await surface.invokeAction('model')
    expect(surface.getSnapshot()).toEqual([
      expect.objectContaining({ id: 'model', action: { type: 'agent-picker' } })
    ])
  })
})
