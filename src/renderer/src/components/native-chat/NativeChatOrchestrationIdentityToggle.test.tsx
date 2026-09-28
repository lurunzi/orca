/**
 * @vitest-environment happy-dom
 */
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatOrchestrationIdentity } from './use-native-chat-orchestration-identity'
import { NativeChatOrchestrationIdentityToggle } from './NativeChatOrchestrationIdentityToggle'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (key: string, fallback: string) => {
    if (key.includes('toggleLabel')) {
      return 'Coordinator'
    }
    return fallback
  }
}))

function createMockIdentity(
  overrides?: Partial<NativeChatOrchestrationIdentity>
): NativeChatOrchestrationIdentity {
  return {
    offered: true,
    status: { state: 'disabled' },
    pending: false,
    toggle: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    ...overrides
  }
}

describe('NativeChatOrchestrationIdentityToggle', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders nothing when not offered', () => {
    const identity = createMockIdentity({ offered: false })
    const { container } = render(<NativeChatOrchestrationIdentityToggle identity={identity} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for worker sessions', () => {
    const identity = createMockIdentity({ status: { state: 'worker' } })
    const { container } = render(<NativeChatOrchestrationIdentityToggle identity={identity} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders ghost button when disabled and toggles to true on click', async () => {
    const identity = createMockIdentity({ status: { state: 'disabled' } })
    render(<NativeChatOrchestrationIdentityToggle identity={identity} />)

    const button = screen.getByRole('button', { name: /orchestration identity disabled/i })
    expect(button).toBeDefined()
    expect(button.getAttribute('data-variant')).toBe('ghost')
    expect(button.getAttribute('aria-pressed')).toBe('false')

    await act(async () => {
      fireEvent.click(button)
    })
    expect(identity.toggle).toHaveBeenCalledWith(true)
  })

  it('renders secondary button when enabled and toggles to false on click', async () => {
    const identity = createMockIdentity({ status: { state: 'enabled' } })
    render(<NativeChatOrchestrationIdentityToggle identity={identity} />)

    const button = screen.getByRole('button', { name: /orchestration identity active/i })
    expect(button).toBeDefined()
    expect(button.getAttribute('data-variant')).toBe('secondary')
    expect(button.getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      fireEvent.click(button)
    })
    expect(identity.toggle).toHaveBeenCalledWith(false)
  })

  it('disables the button when unavailable or busy', () => {
    const identity = createMockIdentity({
      status: { state: 'unavailable', reason: 'busy' }
    })
    render(<NativeChatOrchestrationIdentityToggle identity={identity} />)

    const button = screen.getByRole('button')
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/busy — try after the turn/i)).toBeDefined()
  })

  it('disables the button while pending', () => {
    const identity = createMockIdentity({
      status: { state: 'disabled' },
      pending: true
    })
    render(<NativeChatOrchestrationIdentityToggle identity={identity} />)

    const button = screen.getByRole('button')
    expect(button.hasAttribute('disabled')).toBe(true)
  })
})
