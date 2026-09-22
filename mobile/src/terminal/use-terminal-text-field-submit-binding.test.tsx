import { createElement, useCallback, type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { TextInput } from 'react-native'
import { describe, expect, it, vi } from 'vitest'
import { useTerminalTextFieldSubmitBinding } from './use-terminal-text-field-submit-binding'

/**
 * The seam is mocked so the handler it was handed can be called on demand: the real one is a DOM
 * listener, and what is under test is which closure that listener reaches, on every platform.
 */
const mocks = vi.hoisted(() => ({
  boundHandlers: [] as Array<() => void>,
  unbind: vi.fn()
}))

vi.mock('./terminal-text-field-submit-binding', () => ({
  bindTerminalTextFieldSubmit: (_node: unknown, onSubmit: () => void) => {
    mocks.boundHandlers.push(onSubmit)
    return mocks.unbind
  }
}))

/**
 * A caller memoizing its submit on `[]`, which is what the buffered command field does: its
 * handler is a per-render function closing over `client`, `activeHandle` and `canSend`, all of
 * which arrive in effects after the first render. A binding that refreshed only when the callback
 * identity changed therefore held a handler whose guard could never pass.
 */
function Harness({ value }: { readonly value: string }): null {
  const fieldRef: RefObject<TextInput | null> = { current: null }
  const onSubmit = useCallback(() => {
    submitted.push(value)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the stale closure is the case under test.
  }, [])
  const bindField = useTerminalTextFieldSubmitBinding(fieldRef, onSubmit)
  bindField({} as unknown as TextInput)
  return null
}

let submitted: string[] = []

describe('the terminal text field submit binding', () => {
  it('calls the newest handler, not the one the first render memoized', () => {
    submitted = []
    mocks.boundHandlers.length = 0
    let renderer: ReactTestRenderer | null = null

    act(() => {
      renderer = create(createElement(Harness, { value: 'first' }))
    })
    act(() => {
      renderer?.update(createElement(Harness, { value: 'second' }))
    })
    act(() => {
      mocks.boundHandlers.at(-1)?.()
    })

    expect(submitted).toEqual(['second'])
    act(() => renderer?.unmount())
  })
})
