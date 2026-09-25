// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }))

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

import { NativeChatCoordinatorToggle } from './NativeChatCoordinatorToggle'

function stubIdentity(get: ReturnType<typeof vi.fn>, set: ReturnType<typeof vi.fn> = vi.fn()) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { orchestrationIdentity: { get, set } }
  })
  return { get, set }
}

afterEach(() => cleanup())

beforeEach(() => {
  mocks.toastError.mockReset()
})

describe('NativeChatCoordinatorToggle', () => {
  it('grants identity in one click without touching the draft', async () => {
    const { set } = stubIdentity(
      vi.fn().mockResolvedValue({ state: 'disabled' }),
      vi.fn().mockResolvedValue({ state: 'enabled' })
    )
    render(<NativeChatCoordinatorToggle sessionId="session-1" isWorking={false} />)

    const toggle = await screen.findByRole('button', { name: 'Coordinator mode' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)

    await waitFor(() => expect(set).toHaveBeenCalledExactlyOnceWith('session-1', true))
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'))
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('holds a click made during a turn and applies it when the turn ends', async () => {
    const { set } = stubIdentity(
      vi.fn().mockResolvedValue({ state: 'disabled' }),
      vi.fn().mockResolvedValue({ state: 'enabled' })
    )
    const { rerender } = render(<NativeChatCoordinatorToggle sessionId="session-1" isWorking />)

    const toggle = await screen.findByRole('button', { name: 'Coordinator mode' })
    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Applies after this turn')).not.toBeNull()
    expect(set).not.toHaveBeenCalled()

    rerender(<NativeChatCoordinatorToggle sessionId="session-1" isWorking={false} />)
    await waitFor(() => expect(set).toHaveBeenCalledExactlyOnceWith('session-1', true))
    expect(screen.queryByText('Applies after this turn')).toBeNull()
  })

  it('turns coordinator mode off', async () => {
    const { set } = stubIdentity(
      vi.fn().mockResolvedValue({ state: 'enabled' }),
      vi.fn().mockResolvedValue({ state: 'disabled' })
    )
    render(<NativeChatCoordinatorToggle sessionId="session-1" isWorking={false} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Coordinator mode' }))

    await waitFor(() => expect(set).toHaveBeenCalledExactlyOnceWith('session-1', false))
  })

  it('is hidden for a dispatched worker or a remote session', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ state: 'worker' })
      .mockResolvedValueOnce({ state: 'unavailable', reason: 'not-local' })
    stubIdentity(get)
    const { rerender } = render(
      <NativeChatCoordinatorToggle sessionId="worker" isWorking={false} />
    )
    await waitFor(() => expect(get).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: 'Coordinator mode' })).toBeNull()

    rerender(<NativeChatCoordinatorToggle sessionId="remote" isWorking={false} />)
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: 'Coordinator mode' })).toBeNull()
  })

  it('stays visible while the session record is missing and re-reads on the next turn edge', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ state: 'unavailable', reason: 'missing' })
      .mockResolvedValue({ state: 'disabled' })
    stubIdentity(get)
    const { rerender } = render(<NativeChatCoordinatorToggle sessionId="fresh" isWorking={false} />)

    const toggle = await screen.findByRole('button', { name: 'Coordinator mode' })
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(true))

    rerender(<NativeChatCoordinatorToggle sessionId="fresh" isWorking />)
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false))
  })

  it('reports a grant the host refused', async () => {
    stubIdentity(
      vi.fn().mockResolvedValue({ state: 'disabled' }),
      vi.fn().mockResolvedValue({ state: 'unavailable', reason: 'busy' })
    )
    render(<NativeChatCoordinatorToggle sessionId="session-1" isWorking={false} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Coordinator mode' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Could not change orchestration identity',
        expect.objectContaining({ description: 'Busy — try after the turn' })
      )
    )
  })
})
