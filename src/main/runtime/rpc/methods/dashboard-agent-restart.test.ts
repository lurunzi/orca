import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import { mapDispatcherError } from '../dispatcher-error-response'
import { DASHBOARD_AGENT_RESTART_METHOD as method } from './dashboard-agent-restart'
import { DASHBOARD_ACCOUNT_METHODS } from './dashboard-accounts'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { DashboardToolProvider as Tool } from '../../../dashboard-accounts/dashboard-allocation-protocol'
import {
  DashboardAgentRestartCode as Code,
  DashboardAgentRestartError
} from '../../../dashboard-accounts/dashboard-agent-restart-protocol'

vi.mock('../../../native-chat/agent-session-wire/host/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: vi.fn()
}))
beforeEach(() => {
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'i1')
})
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})
function request(provider = Tool.Codex) {
  return {
    schema_version: 1 as const,
    instance_id: 'i1',
    runtime_id: 'r1',
    target: {
      provider,
      session_id: 's1',
      fence: 7,
      acquisition_generation: 'g1',
      process: { hostId: 'h1', pid: 42, processStartTimeMs: null, spawnToken: 'spawn1' },
      confirm_interrupt: true as const
    }
  }
}
function context(
  identity: Pick<RpcContext, 'caller' | 'clientKind'> = { caller: { kind: 'local-cli' } }
): RpcContext {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this method reads only transport identity and the Runtime id.
  return { ...identity, runtime: { getRuntimeId: () => 'r1' } } as RpcContext
}
function installed(provider = Tool.Codex) {
  const params = request(provider)
  const process = {
    ...params.target,
    account_id: 'a1',
    binding_revision: 2,
    credential_version: 3,
    connection_open: true,
    closing: false,
    ...(provider === Tool.ClaudeCode ? { initialized: true } : {})
  }
  const { confirm_interrupt: _confirm, provider: _tool, ...launch } = process
  const read = vi.fn(() => ({ pending_acquisitions: 0, processes: [launch] }))
  const registration = vi.fn(() => ({
    adapter: { readDashboardCodexProcesses: read, readDashboardClaudeLaunches: read }
  }))
  const result = {
    ...params.target,
    fence: 8,
    acquisition_generation: 'g2',
    previous_exit_observed: true
  }
  const { confirm_interrupt: _confirmation, ...restartResult } = result
  const restart = vi.fn(async () => restartResult)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler uses only this registry lookup and restart delegate; report schemas validate the fixture.
  vi.mocked(getStructuredAgentSessionHost).mockReturnValue({
    deps: { agents: { registration } },
    restartAgentForCredentials: restart
  } as never)
  return { params, read, registration, restart, restartResult, launch }
}

describe.skipIf(process.platform !== 'linux')('local confirmed pool Agent restart RPC', () => {
  it.each([
    { provider: Tool.Codex, agent: 'codex' },
    { provider: Tool.ClaudeCode, agent: 'claude' }
  ])(
    'validates $provider pool source and delegates only the strict Host request',
    async ({ provider, agent }) => {
      const fixture = installed(provider)
      expect(DASHBOARD_ACCOUNT_METHODS).toContain(method)
      expect(method.name).toBe('dashboard.accounts.restartAgent')
      expect(method.permission).toBe('accounts-admin')
      const result = await method.handler(fixture.params, context())
      expect(fixture.registration).toHaveBeenCalledExactlyOnceWith(agent)
      expect(fixture.read).toHaveBeenCalledOnce()
      expect(fixture.restart).toHaveBeenCalledExactlyOnceWith(fixture.params.target)
      expect(result).toEqual({
        schema_version: 1,
        instance_id: 'i1',
        runtime_id: 'r1',
        result: fixture.restartResult
      })
    }
  )

  it.each([
    {},
    { caller: { kind: 'desktop' as const } },
    { caller: { kind: 'paired-device' as const, deviceId: 'd1' } },
    { caller: { kind: 'local-cli' as const }, clientKind: 'mobile' as const },
    { caller: { kind: 'local-cli' as const }, clientKind: 'runtime' as const }
  ])('rejects non-local transport identity %# before consulting Host', async (identity) => {
    await expect(method.handler(request(), context(identity))).rejects.toThrow(
      'dashboard_allocation_unavailable'
    )
    expect(getStructuredAgentSessionHost).not.toHaveBeenCalled()
  })

  it('requires exact instance/Runtime before Host lookup', async () => {
    for (const params of [
      { ...request(), instance_id: 'another' },
      { ...request(), runtime_id: 'another' }
    ]) {
      await expect(method.handler(params, context())).rejects.toMatchObject({
        code: Code.TargetChanged
      })
    }
    expect(getStructuredAgentSessionHost).not.toHaveBeenCalled()
    vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', undefined)
    await expect(method.handler(request(), context())).rejects.toMatchObject({
      code: Code.Unavailable
    })
  })

  it('rejects unconfirmed and extra fields at every strict request boundary', () => {
    const params = request()
    expect(
      method.params.safeParse({ ...params, target: { ...params.target, confirm_interrupt: false } })
        .success
    ).toBe(false)
    expect(method.params.safeParse({ ...params, access_token: 'private' }).success).toBe(false)
    expect(
      method.params.safeParse({ ...params, target: { ...params.target, credential: 'private' } })
        .success
    ).toBe(false)
    expect(
      method.params.safeParse({
        ...params,
        target: { ...params.target, process: { ...params.target.process, credential: 'private' } }
      }).success
    ).toBe(false)
  })

  it('keeps missing Host and missing report capability unavailable, never creating a Host', async () => {
    vi.mocked(getStructuredAgentSessionHost).mockReturnValue(null)
    await expect(method.handler(request(), context())).rejects.toMatchObject({
      code: Code.Unavailable
    })
    const fixture = installed()
    fixture.registration.mockReturnValueOnce({ adapter: {} } as never)
    await expect(method.handler(request(), context())).rejects.toMatchObject({
      code: Code.Unavailable
    })
    expect(fixture.restart).not.toHaveBeenCalled()
  })

  it.each([
    { processes: [] },
    { closing: true },
    { connection_open: false },
    { fence: 6 },
    { acquisition_generation: 'old' }
  ])('refuses changed/absent source before stopping %#', async (changes) => {
    const fixture = installed()
    fixture.read.mockReturnValueOnce({
      pending_acquisitions: 0,
      processes: 'processes' in changes ? [] : [{ ...fixture.launch, ...changes }]
    })
    await expect(method.handler(fixture.params, context())).rejects.toMatchObject({
      code: Code.TargetChanged
    })
    expect(fixture.restart).not.toHaveBeenCalled()
  })

  it('refuses uninitialized Claude and duplicate source session records', async () => {
    const fixture = installed(Tool.ClaudeCode)
    fixture.read.mockReturnValueOnce({
      pending_acquisitions: 0,
      processes: [{ ...fixture.launch, initialized: false }]
    })
    await expect(method.handler(fixture.params, context())).rejects.toMatchObject({
      code: Code.TargetChanged
    })
    fixture.read.mockReturnValueOnce({
      pending_acquisitions: 0,
      processes: [fixture.launch, fixture.launch]
    })
    await expect(method.handler(fixture.params, context())).rejects.toMatchObject({
      code: Code.TargetChanged
    })
    expect(fixture.restart).not.toHaveBeenCalled()
  })

  it('preserves fixed Host errors through the dispatcher without provider text', async () => {
    const fixture = installed()
    fixture.restart.mockRejectedValueOnce(new DashboardAgentRestartError(Code.ExitUnconfirmed))
    const failure = await method
      .handler(fixture.params, context())
      .catch((error: unknown) =>
        mapDispatcherError(
          { id: 'q1', authToken: 'private', method: method.name },
          { runtimeId: 'r1' },
          error
        )
      )
    expect(failure).toMatchObject({ ok: false, error: { message: Code.ExitUnconfirmed } })
    fixture.restart.mockRejectedValueOnce(new Error('private provider error and token'))
    await expect(method.handler(fixture.params, context())).rejects.toMatchObject({
      code: Code.Failed,
      message: Code.Failed
    })
  })

  it('rejects unknown report and result fields without leaking them', async () => {
    const fixture = installed()
    fixture.read.mockReturnValueOnce({
      pending_acquisitions: 0,
      processes: [{ ...fixture.launch, access_token: 'private' }]
    } as never)
    await expect(method.handler(fixture.params, context())).rejects.toMatchObject({
      code: Code.Failed,
      message: Code.Failed
    })
    expect(fixture.restart).not.toHaveBeenCalled()
    fixture.restart.mockResolvedValueOnce({
      ...fixture.restartResult,
      access_token: 'private'
    } as never)
    await expect(method.handler(fixture.params, context())).rejects.toMatchObject({
      code: Code.Failed,
      message: Code.Failed
    })
  })
})
