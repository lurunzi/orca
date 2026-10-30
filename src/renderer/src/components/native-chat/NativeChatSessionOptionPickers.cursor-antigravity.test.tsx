// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NativeChatSessionOptionPickers } from './NativeChatSessionOptionPickers'
import { createNativeChatPtySessionOptions } from '../../../../shared/native-chat-pty-session-options'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    Object.entries(values ?? {}).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
      fallback
    )
}))
afterEach(cleanup)

it('uses the shared Thinking switch while sending the exact Cursor model id', async () => {
  const user = userEvent.setup()
  const dispatch = vi.fn()
  const surface = createNativeChatPtySessionOptions({
    agent: 'cursor',
    scopeKey: 'cursor-thinking-picker-test',
    modelLabel: 'Model',
    mode: 'live',
    initialModels: [
      { id: 'claude-opus-5-high-fast', label: 'Claude Opus 5 1M Fast', options: [] },
      {
        id: 'claude-opus-5-thinking-high-fast',
        label: 'Claude Opus 5 1M Thinking Fast',
        options: []
      }
    ],
    reportedValues: { model: 'claude-opus-5-high-fast' },
    dispatchCommand: dispatch
  })!
  render(
    <TooltipProvider>
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={surface.getSnapshot()}
        isWorking={false}
      />
    </TooltipProvider>
  )
  await user.click(screen.getByRole('button', { name: /Model Claude Opus 5/ }))
  expect(screen.getAllByRole('option')).toHaveLength(1)
  await user.click(screen.getByRole('switch', { name: 'Thinking' }))
  await waitFor(() =>
    expect(dispatch).toHaveBeenCalledWith('/model claude-opus-5-thinking-high-fast', {
      detectAgentInteraction: 'cursor-model-picker',
      expectedChoiceLabel: 'Claude Opus 5 1M Thinking Fast'
    })
  )
})

it('sends the exact Cursor Fast variant through the separate Speed row', async () => {
  const user = userEvent.setup()
  const dispatch = vi.fn()
  const surface = createNativeChatPtySessionOptions({
    agent: 'cursor',
    scopeKey: 'cursor-speed-picker-test',
    modelLabel: 'Model',
    mode: 'live',
    initialModels: [
      { id: 'grok-4.7-low', label: 'Grok 4.7 Low', options: [] },
      { id: 'grok-4.7-low-fast', label: 'Grok 4.7 Low Fast', options: [] },
      { id: 'grok-4.7-high', label: 'Grok 4.7 High', options: [] },
      { id: 'grok-4.7-high-fast', label: 'Grok 4.7 High Fast', options: [] }
    ],
    reportedValues: { model: 'grok-4.7-low' },
    dispatchCommand: dispatch
  })!
  render(
    <TooltipProvider>
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={surface.getSnapshot()}
        isWorking={false}
      />
    </TooltipProvider>
  )
  await user.click(screen.getByRole('button', { name: /Model Grok 4.7/ }))
  expect(screen.getAllByRole('option')).toHaveLength(1)
  await user.click(screen.getByRole('radio', { name: 'Fast' }))
  await waitFor(() =>
    expect(dispatch).toHaveBeenCalledWith('/model grok-4.7-low-fast', {
      detectAgentInteraction: 'cursor-model-picker',
      expectedChoiceLabel: 'Grok 4.7 Low Fast'
    })
  )
})

it('holds Antigravity model and effort picks until idle and sends only the final model', async () => {
  const user = userEvent.setup()
  const dispatch = vi.fn()
  const surface = createNativeChatPtySessionOptions({
    agent: 'antigravity',
    scopeKey: 'antigravity-running-picker-test',
    modelLabel: 'Model',
    mode: 'live',
    initialModels: [
      { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)', options: [] },
      { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)', options: [] },
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', options: [] }
    ],
    reportedValues: { model: 'gemini-4-argon-high' },
    dispatchCommand: dispatch
  })!
  const view = (isWorking: boolean) => (
    <TooltipProvider>
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={surface.getSnapshot()}
        isWorking={isWorking}
      />
    </TooltipProvider>
  )
  const { rerender } = render(view(true))
  const trigger = screen.getByRole('button', { name: /Model Gemini 4 Argon/ })
  expect(trigger).toHaveProperty('disabled', false)
  await user.click(trigger)
  await user.click(screen.getByRole('option', { name: 'Gemini 3.8 Flash (High)' }))
  await user.click(screen.getByRole('option', { name: 'Gemini 4 Argon' }))
  await user.click(screen.getByRole('radio', { name: 'Low' }))
  expect(dispatch).not.toHaveBeenCalled()
  rerender(view(false))
  await waitFor(() => expect(dispatch).toHaveBeenCalledExactlyOnceWith('/model gemini-4-argon-low'))
})
