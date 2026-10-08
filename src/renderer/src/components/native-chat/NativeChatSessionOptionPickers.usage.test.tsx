// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import './native-chat-picker-menu-test-fixture'
import { NativeChatSessionOptionPickers } from './NativeChatSessionOptionPickers'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'

const usage: ProviderRateLimits = {
  provider: 'antigravity',
  status: 'ok',
  updatedAt: 1,
  error: null,
  session: null,
  weekly: null,
  buckets: [
    {
      name: 'Gemini Models',
      usedPercent: 25,
      windowMinutes: 10080,
      resetsAt: null,
      resetDescription: null
    },
    {
      name: 'Claude and GPT models',
      usedPercent: 80,
      windowMinutes: 10080,
      resetsAt: null,
      resetDescription: null
    }
  ]
}
const surface = {
  getSnapshot: () => [],
  setOption: vi.fn(),
  invokeAction: vi.fn(),
  subscribe: () => () => {}
}
const model: SessionOptionDescriptor = {
  id: 'model',
  label: 'Model',
  category: 'model',
  valueSource: 'reported',
  transport: 'catalog',
  settable: true,
  kind: {
    type: 'select',
    currentValue: 'gemini-high',
    choices: [
      { value: 'gemini-high', label: 'Gemini Flash (High)' },
      { value: 'gemini-low', label: 'Gemini Flash (Low)' },
      { value: 'claude-opus', label: 'Claude Opus' }
    ]
  }
}
afterEach(cleanup)
describe('Model usage in native chat', () => {
  it('keeps the current model quota in its trigger and gives each menu row its own pool', () => {
    render(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[model]}
        isWorking={false}
        modelUsage={usage}
      />
    )
    expect(
      within(screen.getByRole('button', { name: 'Model Gemini Flash' })).getByText('25% used')
    ).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Gemini Flash.*7d 25% used/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Claude Opus.*7d 80% used/ })).toBeTruthy()
  })
  it('does not leave a stale percentage in the trigger after a failed refresh', () => {
    render(
      <NativeChatSessionOptionPickers
        surface={surface}
        snapshot={[model]}
        isWorking={false}
        modelUsage={{ ...usage, status: 'error' }}
      />
    )
    expect(screen.queryByText('25% used')).toBeNull()
  })
})
