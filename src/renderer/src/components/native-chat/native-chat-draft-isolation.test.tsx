// @vitest-environment happy-dom
import { createRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeChatPromptEditor } from './NativeChatPromptEditor'
import type { NativeChatComposerInput } from './native-chat-composer-input'
import {
  clearNativeChatDraftCacheForTests,
  readNativeChatDraftCache,
  writeNativeChatDraftCache
} from './native-chat-draft-cache'

beforeEach(() => clearNativeChatDraftCacheForTests())
afterEach(cleanup)

function editor(scopeKey: string, initialValue = '') {
  const inputRef = createRef<NativeChatComposerInput>()
  const props = {
    inputRef,
    initialValue,
    disabled: false,
    placeholder: 'Message',
    onChange: vi.fn(),
    onSelect: vi.fn()
  }
  const view = render(<NativeChatPromptEditor scopeKey={scopeKey} {...props} />)
  return { view, inputRef, props }
}

describe('repro: draft isolation', () => {
  it('typing in one mounted editor leaves another editor draft alone', () => {
    writeNativeChatDraftCache('a', 'draft a')
    const a = editor('a', 'draft a')
    writeNativeChatDraftCache('b', 'draft b')
    const b = editor('b', 'draft b')
    act(() => {
      b.inputRef.current!.value = 'typed in b'
    })
    expect(readNativeChatDraftCache('a')).toBe('draft a')
    expect(a.inputRef.current!.value).toBe('draft a')
  })

  it('an editor re-rendered with a new scope writes to the new scope', () => {
    writeNativeChatDraftCache('a', 'draft a')
    const a = editor('a', 'draft a')
    a.view.rerender(<NativeChatPromptEditor scopeKey="b" {...a.props} />)
    act(() => {
      a.inputRef.current!.value = 'typed after switch'
    })
    expect(readNativeChatDraftCache('a')).toBe('draft a')
  })
})
