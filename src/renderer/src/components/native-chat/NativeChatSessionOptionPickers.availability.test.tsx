// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../ui/tooltip'
import { CLAUDE_SESSION_OPTION_CATALOG } from '../../../../shared/agent-session-option-catalog-claude-codex'
import {
  applyStructuredAgentSessionOptions,
  createStructuredAgentSessionOptionState,
  structuredAgentSessionOptionSnapshot
} from '../../../../shared/structured-agent-session-options'
import { NativeChatSessionOptionPickers } from './NativeChatSessionOptionPickers'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    Object.entries(values ?? {}).reduce(
      (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
      fallback
    )
}))

afterEach(cleanup)

it.each([
  {
    model: 'opus',
    supportsFastMode: true,
    reason: 'extra_usage_disabled',
    explanation: 'Fast mode requires paid usage credits.'
  },
  {
    model: 'fable',
    supportsFastMode: undefined,
    reason: 'availability-unconfirmed',
    explanation: 'Fast mode availability has not been confirmed for this session.'
  }
])('keeps blocked $model Fast visible and refreshes on reopening', async (scenario) => {
  const user = userEvent.setup()
  const options = {
    models: [
      {
        id: scenario.model,
        label: scenario.model,
        isDefault: true,
        supportsFastMode: scenario.supportsFastMode,
        efforts: [
          { value: 'low', label: 'Low' },
          { value: 'high', label: 'High' }
        ]
      }
    ],
    current: {
      model: scenario.model,
      effort: 'high',
      fastMode: true,
      confirmed: ['model', 'effort', 'fastMode']
    }
  }
  let state = applyStructuredAgentSessionOptions(
    createStructuredAgentSessionOptionState('claude'),
    CLAUDE_SESSION_OPTION_CATALOG,
    { ...options, fastModeSupport: { supported: false, reason: scenario.reason } }
  )
  let snapshot = structuredAgentSessionOptionSnapshot(state)
  const refresh = vi.fn()
  const setOption = vi.fn(async () => ({ snapshot }))
  const surface = {
    refresh,
    setOption,
    getSnapshot: () => snapshot,
    invokeAction: async () => ({ snapshot }),
    subscribe: () => () => {}
  }
  const view = () => (
    <TooltipProvider>
      <NativeChatSessionOptionPickers surface={surface} snapshot={snapshot} isWorking={false} />
    </TooltipProvider>
  )
  const { rerender } = render(view())
  expect(screen.getByRole('button', { name: /effort High/i }).textContent).toBe('High')
  await user.click(screen.getByRole('button', { name: /effort High/i }))
  expect(refresh).toHaveBeenCalledOnce()
  const blocked = await screen.findByRole('switch', { name: 'Fast mode' })
  expect(blocked.getAttribute('aria-disabled')).toBe('true')
  expect(blocked.getAttribute('aria-checked')).toBe('false')
  expect(screen.getByText('Fast mode').getAttribute('data-unavailable')).toBe('true')
  expect(screen.getByText(scenario.explanation)).toBeDefined()
  await user.click(blocked)
  expect(setOption).not.toHaveBeenCalled()
  await user.keyboard('{Escape}')
  state = applyStructuredAgentSessionOptions(state, CLAUDE_SESSION_OPTION_CATALOG, {
    ...options,
    models: options.models.map((model) => ({ ...model, supportsFastMode: true })),
    current: { ...options.current, fastModeState: 'on' },
    fastModeSupport: { supported: true, accountVerified: true }
  })
  snapshot = structuredAgentSessionOptionSnapshot(state)
  rerender(view())
  expect(screen.getByRole('button', { name: /effort High/i }).textContent).toBe('High · Fast')
  await user.click(screen.getByRole('button', { name: /effort High/i }))
  expect(refresh).toHaveBeenCalledTimes(2)
  const recovered = await screen.findByRole('switch', { name: 'Fast mode' })
  expect(recovered.getAttribute('aria-disabled')).toBeNull()
  expect(recovered.getAttribute('aria-checked')).toBe('true')
  expect(screen.getByText('Fast mode').getAttribute('data-unavailable')).toBe('false')
  await user.click(recovered)
  expect(setOption).toHaveBeenCalledWith('fastMode', false)
})
