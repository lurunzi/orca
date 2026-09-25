import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  call,
  clearStructuredHostStub,
  hostCalls,
  installStructuredHostStub,
  SESSION,
  STRUCTURED_CLIENT
} from './structured-agent-session-rpc.test-fixture'

beforeEach(() => {
  installStructuredHostStub()
})

afterEach(() => {
  clearStructuredHostStub()
})

describe('agentSession.releaseReservation', () => {
  it('forwards the fenced release to the host', async () => {
    const response = await call(
      'agentSession.releaseReservation',
      { sessionId: SESSION, expectedRuntimeFence: 9 },
      STRUCTURED_CLIENT
    )

    expect(response).toMatchObject({ ok: true, result: { ok: true } })
    expect(hostCalls.releaseReservation).toHaveBeenCalledWith(SESSION, 9)
  })

  it.each([
    { sessionId: SESSION },
    { sessionId: SESSION, expectedRuntimeFence: 0 },
    { sessionId: SESSION, expectedRuntimeFence: 9, force: true }
  ])('rejects params %j without reaching the host', async (params) => {
    const response = await call('agentSession.releaseReservation', params, STRUCTURED_CLIENT)

    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(hostCalls.releaseReservation).not.toHaveBeenCalled()
  })

  it('stays hidden from a client without the structured capability', async () => {
    const response = await call(
      'agentSession.releaseReservation',
      { sessionId: SESSION, expectedRuntimeFence: 9 },
      { clientKind: 'runtime', clientCapabilities: [] }
    )

    expect(response).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('structured_agent_session_unsupported') }
    })
    expect(hostCalls.releaseReservation).not.toHaveBeenCalled()
  })
})
