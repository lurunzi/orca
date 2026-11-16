import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { seedNativeChatAppliedSessionOptions } from './native-chat-session-option-cache'
import { createNativeChatPtySessionOptions } from './native-chat-pty-session-options'

describe('native chat PTY session options', () => {
  let scopeKey: string
  beforeEach(() => {
    scopeKey = `native-chat-pty-session-options-test:${randomUUID()}`
  })

  it('does not re-assert absolute state when a typed flip clears tracking mid-dispatch', async () => {
    seedNativeChatAppliedSessionOptions(scopeKey, 'claude', {
      model: 'opus',
      effort: 'high',
      fastMode: true
    })
    let resolveDispatch: (() => void) | undefined
    const dispatch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDispatch = resolve
        })
    )
    const surface = createNativeChatPtySessionOptions({
      agent: 'claude',
      scopeKey,
      mode: 'live',
      modelLabel: 'Model',
      dispatchCommand: dispatch
    })!

    const pending = surface.setOption('fastMode', false)
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled())
    // A typed flip during dispatch must supersede the picker’s value.
    surface.recordOutgoingCommand('/fast')
    resolveDispatch?.()
    await pending
    expect(surface.getSnapshot().find(({ id }) => id === 'fastMode')).toMatchObject({
      valueSource: 'unknown',
      action: { type: 'toggle-command' }
    })
  })

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
