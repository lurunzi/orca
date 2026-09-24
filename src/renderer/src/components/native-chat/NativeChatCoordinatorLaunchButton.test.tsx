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
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>
}))

import {
  NativeChatCoordinatorLaunchButton,
  withCoordinatorPrompt
} from './NativeChatCoordinatorLaunchButton'

const PROMPT = 'Use Orca orchestration to coordinate: '

function stubIdentity(api: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> }) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { orchestrationIdentity: api }
  })
}

afterEach(() => cleanup())

beforeEach(() => {
  mocks.toastError.mockReset()
})

describe('withCoordinatorPrompt', () => {
  it('prefixes the prompt onto the existing draft', () => {
    expect(withCoordinatorPrompt('', PROMPT)).toBe(PROMPT)
    expect(withCoordinatorPrompt('  fix the build', PROMPT)).toBe(`${PROMPT}fix the build`)
  })

  it('leaves a draft that already starts with the prompt unchanged', () => {
    const draft = `${PROMPT}fix the build`
    expect(withCoordinatorPrompt(draft, PROMPT)).toBe(draft)
  })
})

describe('NativeChatCoordinatorLaunchButton', () => {
  it('inserts into the current composer without granting identity for a PTY agent', () => {
    const get = vi.fn()
    stubIdentity({ get, set: vi.fn() })
    const onInsert = vi.fn()
    render(<NativeChatCoordinatorLaunchButton onInsert={onInsert} />)

    fireEvent.click(screen.getByRole('button', { name: 'Coordinate with Orca' }))

    expect(onInsert).toHaveBeenCalledOnce()
    expect(get).not.toHaveBeenCalled()
  })

  it('grants coordinator identity to the current structured session', async () => {
    const get = vi.fn().mockResolvedValue({ state: 'disabled' })
    const set = vi.fn().mockResolvedValue({ state: 'enabled' })
    stubIdentity({ get, set })
    const onInsert = vi.fn()
    render(<NativeChatCoordinatorLaunchButton onInsert={onInsert} identitySessionId="session-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Coordinate with Orca' }))

    expect(onInsert).toHaveBeenCalledOnce()
    await waitFor(() => expect(set).toHaveBeenCalledExactlyOnceWith('session-1', true))
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('does not restart a session that already has identity', async () => {
    const get = vi.fn().mockResolvedValue({ state: 'enabled' })
    const set = vi.fn()
    stubIdentity({ get, set })
    render(<NativeChatCoordinatorLaunchButton onInsert={vi.fn()} identitySessionId="session-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Coordinate with Orca' }))

    await waitFor(() => expect(get).toHaveBeenCalledOnce())
    expect(set).not.toHaveBeenCalled()
  })

  it('still inserts but reports when the session is busy', async () => {
    const get = vi.fn().mockResolvedValue({ state: 'unavailable', reason: 'busy' })
    stubIdentity({ get, set: vi.fn() })
    const onInsert = vi.fn()
    render(<NativeChatCoordinatorLaunchButton onInsert={onInsert} identitySessionId="session-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Coordinate with Orca' }))

    expect(onInsert).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Coordinator access not granted',
        expect.objectContaining({ description: 'Busy — try after the turn' })
      )
    )
  })
})
