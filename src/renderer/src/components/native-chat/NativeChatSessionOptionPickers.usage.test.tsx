// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import './native-chat-picker-menu-test-fixture'
import { NativeChatSessionOptionPickers } from './NativeChatSessionOptionPickers'
import { useAppStore } from '@/store'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'

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
describe('Model picker labels', () => {
  it.each(['used', 'remaining'] as const)(
    'keeps model and effort labels free of quota when usage display is %s',
    (display) => {
      useAppStore.setState({
        usagePercentageDisplay: display,
        rateLimits: {
          ...useAppStore.getState().rateLimits,
          antigravity: {
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
              }
            ]
          }
        }
      })
      render(
        <NativeChatSessionOptionPickers surface={surface} snapshot={[model]} isWorking={false} />
      )
      expect(screen.getByRole('button', { name: 'Model Gemini Flash' }).textContent).toBe(
        'Gemini Flash'
      )
      expect(screen.getByRole('radio', { name: 'Gemini Flash' })).toBeTruthy()
      expect(screen.getByRole('radio', { name: 'Claude Opus' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Effort High' })).toBeTruthy()
      expect(screen.queryByText(/%|7d|5h/)).toBeNull()
    }
  )
})
