import { afterEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import { OrcaRuntimeService } from '../../orca-runtime'
import { DASHBOARD_AGENT_RESTART_METHOD as method } from './dashboard-agent-restart'
import { DashboardAgentRestartCode } from '../../../dashboard-accounts/dashboard-agent-restart-protocol'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/host/structured-agent-session-registry'

vi.mock('../../../native-chat/agent-session-wire/host/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: vi.fn()
}))
afterEach(() => vi.resetAllMocks())

describe('actual local restart dispatcher parameter boundary', () => {
  it.each([
    { 'private-token-as-key': 'private-value' },
    {
      schema_version: 1,
      instance_id: 'i1',
      runtime_id: 'r1',
      target: { 'private-token-as-key': true }
    }
  ])('returns only a fixed error for malformed and unknown metadata %#', async (params) => {
    const dispatcher = new RpcDispatcher({ runtime: new OrcaRuntimeService(), methods: [method] })
    const response = await dispatcher.dispatch(
      { id: 'q1', authToken: 'private-auth', method: method.name, params },
      {
        caller: { kind: 'local-cli' }
      }
    )
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument', message: DashboardAgentRestartCode.InvalidRequest }
    })
    expect(JSON.stringify(response)).not.toMatch(/private-token|private-value|private-auth/)
    expect(getStructuredAgentSessionHost).not.toHaveBeenCalled()
  })
})
