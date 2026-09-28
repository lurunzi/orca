/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StructuredSessionOrchestrationIdentityStatus } from '../../../../shared/structured-session-orchestration-identity'
import { useNativeChatOrchestrationIdentity } from './use-native-chat-orchestration-identity'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

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

describe('useNativeChatOrchestrationIdentity', () => {
  beforeEach(() => {
    toastError.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('reports offered=false when API is absent or target is not local', () => {
    Object.defineProperty(window, 'api', { configurable: true, value: {} })
    const { result } = renderHook(() =>
      useNativeChatOrchestrationIdentity({ sessionId: 's1', target: LOCAL })
    )
    expect(result.current.offered).toBe(false)
    cleanup()

    const api = installApi({ state: 'disabled' })
    const { result: remoteResult } = renderHook(() =>
      useNativeChatOrchestrationIdentity({
        sessionId: 's1',
        target: { kind: 'environment', environmentId: 'env-1' }
      })
    )
    expect(remoteResult.current.offered).toBe(false)
    expect(api.get).not.toHaveBeenCalled()
  })

  it('reports offered=false when enabled=false', () => {
    const api = installApi({ state: 'disabled' })
    const { result } = renderHook(() =>
      useNativeChatOrchestrationIdentity({
        sessionId: 's1',
        target: LOCAL,
        enabled: false
      })
    )
    expect(result.current.offered).toBe(false)
    expect(api.get).not.toHaveBeenCalled()
  })

  it('fetches initial status and refreshes when isWorking changes', async () => {
    const api = installApi({ state: 'disabled' })
    const { result, rerender } = renderHook(
      ({ isWorking }) =>
        useNativeChatOrchestrationIdentity({
          sessionId: 's1',
          target: LOCAL,
          isWorking
        }),
      { initialProps: { isWorking: false } }
    )

    await waitFor(() => expect(result.current.status).toEqual({ state: 'disabled' }))
    expect(api.get).toHaveBeenCalledTimes(1)

    rerender({ isWorking: true })
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
  })

  it('toggles identity successfully', async () => {
    const api = installApi({ state: 'disabled' })
    const { result } = renderHook(() =>
      useNativeChatOrchestrationIdentity({ sessionId: 'session-123', target: LOCAL })
    )

    await waitFor(() => expect(result.current.status).toEqual({ state: 'disabled' }))

    await act(async () => {
      await result.current.toggle(true)
    })

    expect(api.set).toHaveBeenCalledWith('session-123', true)
    expect(result.current.status).toEqual({ state: 'enabled' })
    expect(result.current.pending).toBe(false)
  })

  it('handles toggle failure with toast error', async () => {
    installApi(
      { state: 'enabled' },
      vi.fn(async () => {
        throw new Error('boom')
      })
    )
    const { result } = renderHook(() =>
      useNativeChatOrchestrationIdentity({ sessionId: 'session-123', target: LOCAL })
    )

    await waitFor(() => expect(result.current.status).toEqual({ state: 'enabled' }))

    await act(async () => {
      await result.current.toggle(false)
    })

    expect(toastError).toHaveBeenCalled()
    expect(result.current.pending).toBe(false)
  })
})
