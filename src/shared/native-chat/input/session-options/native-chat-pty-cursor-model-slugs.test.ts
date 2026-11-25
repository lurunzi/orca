import { describe, expect, it, vi } from 'vitest'
import { seedNativeChatAppliedSessionOptions } from './native-chat-session-option-cache'
import { createNativeChatPtySessionOptions } from './native-chat-pty-session-options'

describe('native chat PTY Cursor model slugs', () => {
  it('recomposes Cursor model slugs for live option changes', async () => {
    seedNativeChatAppliedSessionOptions('pty-1', 'cursor', {
      model: 'gpt-5.3-codex',
      effort: 'medium',
      fastMode: true
    })
    const dispatch = vi.fn()
    const surface = createNativeChatPtySessionOptions({
      agent: 'cursor',
      scopeKey: 'pty-1',
      mode: 'live',
      modelLabel: 'Model',
      dispatchCommand: dispatch
    })!
    expect(surface.getSnapshot().find(({ id }) => id === 'effort')?.settable).toBe(true)

    await surface.setOption('effort', 'high')

    expect(dispatch).toHaveBeenCalledWith('/model gpt-5.3-codex-high-fast', {
      detectAgentInteraction: 'cursor-model-picker',
      expectedChoiceLabel: 'GPT-5.3 Codex'
    })
    expect(surface.getSnapshot().find(({ id }) => id === 'effort')).toMatchObject({
      valueSource: 'dispatched',
      kind: { currentValue: 'high' }
    })
  })
})
