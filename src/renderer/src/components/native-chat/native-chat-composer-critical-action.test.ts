import { describe, expect, it } from 'vitest'
import { resolveComposerCriticalAction } from './native-chat-composer-critical-action'

const idle = { isWorking: false, hasPty: true, disabled: false, onStop: () => {} }
const empty = { draft: '', imageAttachments: [] }

describe('resolveComposerCriticalAction', () => {
  it('stops a running turn', () => {
    expect(resolveComposerCriticalAction({ ...idle, isWorking: true }, empty)).toEqual({
      kind: 'stop',
      disabled: false
    })
  })

  it('stops background tasks from an empty idle composer', () => {
    expect(
      resolveComposerCriticalAction({ ...idle, onStopBackgroundTasks: () => {} }, empty)
    ).toEqual({ kind: 'stop-background-tasks', disabled: false })
  })

  it('keeps Send for a typed draft while background tasks run', () => {
    expect(
      resolveComposerCriticalAction(
        { ...idle, onStopBackgroundTasks: () => {} },
        { ...empty, draft: 'follow up' }
      )
    ).toEqual({ kind: 'send', disabled: false })
  })

  it('disables Send while an image attachment is still saving', () => {
    expect(
      resolveComposerCriticalAction(idle, {
        draft: 'hi',
        imageAttachments: [{ id: 'image-1', path: '', pending: true }]
      })
    ).toEqual({ kind: 'send', disabled: true })
  })

  it('disables an empty Send when nothing runs', () => {
    expect(resolveComposerCriticalAction(idle, empty)).toEqual({ kind: 'send', disabled: true })
  })
})
