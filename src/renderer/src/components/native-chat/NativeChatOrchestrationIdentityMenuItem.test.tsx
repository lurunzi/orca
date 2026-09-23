/**
 * @vitest-environment happy-dom
 */
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StructuredSessionOrchestrationIdentityStatus } from '../../../../shared/structured-session-orchestration-identity'
import { NativeChatOrchestrationIdentityMenuItem } from './NativeChatOrchestrationIdentityMenuItem'

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuSeparator: () => null,
  DropdownMenuCheckboxItem: ({
    checked,
    disabled,
    onCheckedChange,
    children
  }: {
    checked?: boolean
    disabled?: boolean
    onCheckedChange?: (checked: boolean) => void
    children?: ReactNode
  }) => (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked === true}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
    >
      {children}
    </button>
  )
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

const LOCAL = { kind: 'local' } as const

type Api = NonNullable<typeof window.api.orchestrationIdentity>

function installApi(
  status: StructuredSessionOrchestrationIdentityStatus,
  setImpl?: Api['set']
): Api {
  const api: Api = {
    get: vi.fn(async () => status),
    set:
      setImpl ??
      vi.fn(async (_id: string, enabled: boolean) => ({
        state: enabled ? ('enabled' as const) : ('disabled' as const)
      }))
  }
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { orchestrationIdentity: api }
  })
  return api
}

describe('NativeChatOrchestrationIdentityMenuItem', () => {
  beforeEach(() => {
    toastError.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders nothing when the desktop API is absent', () => {
    Object.defineProperty(window, 'api', { configurable: true, value: {} })
    const { container } = render(
      <NativeChatOrchestrationIdentityMenuItem sessionId="s1" target={LOCAL} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing and never queries for a remote runtime', () => {
    const api = installApi({ state: 'disabled' })
    const { container } = render(
      <NativeChatOrchestrationIdentityMenuItem
        sessionId="s1"
        target={{ kind: 'environment', environmentId: 'env-1' }}
      />
    )
    expect(container.innerHTML).toBe('')
    expect(api.get).not.toHaveBeenCalled()
  })

  it('reflects enabled and disabled status', async () => {
    installApi({ state: 'enabled' })
    render(<NativeChatOrchestrationIdentityMenuItem sessionId="s1" target={LOCAL} />)
    await waitFor(() =>
      expect(screen.getByRole('menuitemcheckbox').getAttribute('aria-checked')).toBe('true')
    )
    cleanup()

    installApi({ state: 'disabled' })
    render(<NativeChatOrchestrationIdentityMenuItem sessionId="s1" target={LOCAL} />)
    await waitFor(() =>
      expect(screen.getByRole('menuitemcheckbox').hasAttribute('disabled')).toBe(false)
    )
    expect(screen.getByRole('menuitemcheckbox').getAttribute('aria-checked')).toBe('false')
  })

  it('hides for dispatched workers', async () => {
    const api = installApi({ state: 'worker' })
    const { container } = render(
      <NativeChatOrchestrationIdentityMenuItem sessionId="s1" target={LOCAL} />
    )
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })

  it('disables with a short reason while busy', async () => {
    installApi({ state: 'unavailable', reason: 'busy' })
    render(<NativeChatOrchestrationIdentityMenuItem sessionId="s1" target={LOCAL} />)
    await waitFor(() => screen.getByText('Busy — try after the turn'))
    expect(screen.getByRole('menuitemcheckbox').hasAttribute('disabled')).toBe(true)
  })

  it('calls set with the session id and the new value', async () => {
    const api = installApi({ state: 'disabled' })
    render(<NativeChatOrchestrationIdentityMenuItem sessionId="session-42" target={LOCAL} />)
    const item = await waitFor(() => {
      const element = screen.getByRole('menuitemcheckbox')
      expect(element.hasAttribute('disabled')).toBe(false)
      return element
    })
    await act(async () => {
      fireEvent.click(item)
    })
    expect(api.get).toHaveBeenCalledWith('session-42')
    expect(api.set).toHaveBeenCalledWith('session-42', true)
    await waitFor(() => expect(item.getAttribute('aria-checked')).toBe('true'))
  })

  it('toasts when set throws', async () => {
    installApi(
      { state: 'enabled' },
      vi.fn(async () => {
        throw new Error('boom')
      })
    )
    render(<NativeChatOrchestrationIdentityMenuItem sessionId="s1" target={LOCAL} />)
    const item = await waitFor(() => {
      const element = screen.getByRole('menuitemcheckbox')
      expect(element.getAttribute('aria-checked')).toBe('true')
      return element
    })
    await act(async () => {
      fireEvent.click(item)
    })
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(item.getAttribute('aria-checked')).toBe('true')
  })
})
