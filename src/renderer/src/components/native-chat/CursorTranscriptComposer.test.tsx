// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CursorTranscriptComposer } from './CursorTranscriptComposer'
import { clearNativeChatComposerDraftsForTests } from './native-chat-composer-draft-store'

vi.mock('./NativeChatPromptEditor', () => ({
  NativeChatPromptEditor: (props: {
    inputRef: { current: HTMLTextAreaElement | null }
    initialValue: string
    disabled: boolean
    onChange: (input: HTMLTextAreaElement) => void
    onKeyDownCapture: React.KeyboardEventHandler<HTMLTextAreaElement>
    onCompositionStart: () => void
    onCompositionEnd: () => void
  }) => (
    <textarea
      ref={props.inputRef}
      value={props.initialValue}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.currentTarget)}
      onKeyDownCapture={props.onKeyDownCapture}
      onCompositionStart={props.onCompositionStart}
      onCompositionEnd={props.onCompositionEnd}
    />
  )
}))

beforeEach(() => clearNativeChatComposerDraftsForTests())
afterEach(cleanup)

it('retains the draft after unmount, a failed resume and lookup delays', async () => {
  const resume = vi.fn().mockRejectedValue(new Error('Host unavailable'))
  const first = render(
    <CursorTranscriptComposer scopeKey="external" ready={false} resume={resume} />
  )
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '继续检查' } })
  expect(screen.getByRole('button')).toBeDisabled()
  first.unmount()
  render(<CursorTranscriptComposer scopeKey="external" ready resume={resume} />)
  expect(screen.getByRole('textbox')).toHaveValue('继续检查')
  fireEvent.click(screen.getByRole('button'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Host unavailable')
  expect(screen.getByRole('textbox')).toHaveValue('继续检查')
})

it('submits once, holds the draft until confirmed, then clears it', async () => {
  let finish: (sent: boolean) => void = () => undefined
  const resume = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve
      })
  )
  render(<CursorTranscriptComposer scopeKey="external" ready resume={resume} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'next task' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', keyCode: 13 })
  fireEvent.click(screen.getByRole('button'))
  expect(resume).toHaveBeenCalledExactlyOnceWith('next task')
  expect(screen.getByRole('textbox')).toHaveValue('next task')
  await act(async () => finish(true))
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''))
})

it('does not submit Shift+Enter or an IME confirmation', () => {
  const resume = vi.fn()
  render(<CursorTranscriptComposer scopeKey="external" ready resume={resume} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '输入' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', keyCode: 13, shiftKey: true })
  fireEvent.compositionStart(screen.getByRole('textbox'))
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', keyCode: 229, isComposing: true })
  fireEvent.compositionEnd(screen.getByRole('textbox'))
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', keyCode: 13 })
  expect(resume).not.toHaveBeenCalled()
})
