// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionHandoffStatus } from '../../../../shared/agent-session-wire'

const mocks = vi.hoisted(() => ({
  supported: vi.fn<() => Promise<boolean>>(),
  call: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}))

vi.mock('@/runtime/structured-agent-session-host-capability', () => ({
  supportsStructuredAgentSessionHandoffControls: mocks.supported
}))
vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: mocks.call
}))

import { useStructuredAgentSessionHandoff } from './use-structured-agent-session-handoff'

const STUCK: AgentSessionHandoffStatus = {
  owner: 'none',
  direction: 'to-native',
  phase: 'failed',
  stage: 'manual-recovery',
  operationId: null,
  error: { message: 'manual recovery', recoverableOwner: 'none', releaseFence: 9 }
}

function renderHandoff(handoff: AgentSessionHandoffStatus | null, enabled = true) {
  const mutate = vi.fn(async () => null)
  const hook = renderHook(() =>
    useStructuredAgentSessionHandoff({
      sessionId: 'session-1',
      target: { kind: 'environment', environmentId: 'env-1' },
      enabled,
      handoff,
      mutate
    })
  )
  return { ...hook, mutate }
}

afterEach(() => {
  mocks.supported.mockReset()
  mocks.call.mockReset()
})

describe('useStructuredAgentSessionHandoff', () => {
  it('publishes the status only once the host negotiated handoff controls', async () => {
    mocks.supported.mockResolvedValue(true)
    const { result } = renderHandoff(STUCK)

    expect(result.current.status).toBeNull()
    await waitFor(() => expect(result.current.status).toBe(STUCK))
  })

  it('hides every control from a host without the capability', async () => {
    mocks.supported.mockResolvedValue(false)
    const { result } = renderHandoff(STUCK)

    await waitFor(() => expect(mocks.supported).toHaveBeenCalled())
    expect(result.current.status).toBeNull()
  })

  it('does not probe while the transport is disabled', () => {
    renderHandoff(STUCK, false)

    expect(mocks.supported).not.toHaveBeenCalled()
  })

  it('sends the defaulted action explicitly, since the host fingerprints it', () => {
    mocks.supported.mockResolvedValue(true)
    const { result, mutate } = renderHandoff(null)

    act(() => result.current.request('to-tui', 'after-turn'))

    expect(mutate).toHaveBeenCalledWith(
      'agentSession.requestHandoff',
      'agentSession.requestHandoff',
      {
        direction: 'to-tui',
        mode: 'after-turn',
        action: 'start'
      }
    )
  })

  it('releases against the fence the host published and surfaces a refusal', async () => {
    mocks.supported.mockResolvedValue(true)
    mocks.call.mockResolvedValue({
      ok: false,
      refusal: { code: 'agent_session_conflict', message: 'A process owns it.' }
    })
    const { result } = renderHandoff(STUCK)

    const error = await result.current.release()

    expect(mocks.call).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-1' },
      'agentSession.releaseReservation',
      { sessionId: 'session-1', expectedRuntimeFence: 9 }
    )
    expect(error).toBe('A process owns it.')
  })
})
