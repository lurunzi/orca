import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from './index'
import { HANDLER_COMMAND_KEYS, type HandlerContext } from './dispatch'
import { DASHBOARD_ACCOUNT_HANDLERS } from './handlers/dashboard-accounts'
import { COMMAND_SPECS } from './specs'
import { ignoresRemoteSelection } from './remote-selection-scope'
import { RuntimeClientError, RuntimeRpcFailureError } from './runtime-client'
import {
  DashboardAgentRestartCode as Code,
  DASHBOARD_AGENT_RESTART_TIMEOUT_MS
} from '../main/dashboard-accounts/dashboard-agent-restart-protocol'
import { DashboardToolProvider } from '../main/dashboard-accounts/dashboard-allocation-protocol'

const { callMock, constructorMock } = vi.hoisted(() => ({
  callMock: vi.fn(),
  constructorMock: vi.fn()
}))
vi.mock('./runtime-client', async () => {
  const { RuntimeClientError, RuntimeRpcFailureError } = await import('./runtime/types.js')
  return {
    RuntimeClientError,
    RuntimeRpcFailureError,
    RuntimeClient: class {
      call = callMock
      constructor(...args: unknown[]) {
        constructorMock(...args)
      }
    }
  }
})
function request() {
  return {
    schema_version: 1,
    instance_id: 'i1',
    runtime_id: 'r1',
    target: {
      provider: DashboardToolProvider.Codex,
      session_id: 's1',
      fence: 7,
      acquisition_generation: 'g1',
      process: { hostId: 'h1', pid: 42, processStartTimeMs: null, spawnToken: 'spawn1' },
      confirm_interrupt: true
    }
  }
}
function report() {
  const params = request()
  return {
    schema_version: 1,
    instance_id: 'i1',
    runtime_id: 'r1',
    result: {
      provider: params.target.provider,
      session_id: 's1',
      fence: 8,
      acquisition_generation: 'g2',
      process: { ...params.target.process, pid: 43, spawnToken: 'spawn2' },
      previous_exit_observed: true
    }
  }
}
const exitCode = process.exitCode
beforeEach(() => {
  for (const name of ['ORCA_PAIRING_CODE', 'ORCA_REMOTE_PAIRING', 'ORCA_ENVIRONMENT']) {
    vi.stubEnv(name, '')
  }
  vi.stubEnv('ORCA_USER_DATA', '/tmp/dashboard-runtime')
  constructorMock.mockClear()
  callMock
    .mockReset()
    .mockResolvedValue({ result: report(), _meta: { authToken: 'private-runtime-token' } })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  process.exitCode = exitCode
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
const run = (params: unknown = request(), extra: string[] = []) =>
  main([
    'dashboard-accounts',
    'restart',
    '--request-json',
    JSON.stringify(params),
    '--json',
    ...extra
  ])
const output = () => JSON.stringify(vi.mocked(console.log).mock.calls)

describe('local Dashboard confirmed Agent restart CLI', () => {
  it('uses the exact local request, bounded wait and validated metadata-only output', async () => {
    await run()
    expect(constructorMock).toHaveBeenCalledExactlyOnceWith(
      '/tmp/dashboard-runtime',
      10_000,
      null,
      null
    )
    expect(callMock).toHaveBeenCalledExactlyOnceWith('dashboard.accounts.restartAgent', request(), {
      timeoutMs: DASHBOARD_AGENT_RESTART_TIMEOUT_MS - 10_000
    })
    expect(console.log).toHaveBeenCalledOnce()
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toEqual(report())
    expect(output()).not.toMatch(/_meta|authToken|private-runtime-token/)
  })

  it('aligns destructive spec, lazy handler manifest and local-only selection', () => {
    expect(HANDLER_COMMAND_KEYS.has('dashboard-accounts restart')).toBe(true)
    expect(ignoresRemoteSelection(['dashboard-accounts', 'restart'])).toBe(true)
    expect(
      COMMAND_SPECS.find((spec) => spec.path.join(' ') === 'dashboard-accounts restart')
    ).toMatchObject({
      destructive: true,
      allowedFlags: ['help', 'json', 'request-json']
    })
  })

  it.each([
    { ...request(), target: { ...request().target, confirm_interrupt: false } },
    { ...request(), access_token: 'private-credential' },
    {
      ...request(),
      target: {
        ...request().target,
        process: { ...request().target.process, token: 'private-credential' }
      }
    }
  ])('rejects unconfirmed and unknown input before connecting %#', async (params) => {
    await run(params)
    expect(constructorMock).not.toHaveBeenCalled()
    expect(output()).toContain(Code.InvalidRequest)
    expect(output()).not.toContain('private-credential')
    expect(process.exitCode).toBe(1)
  })

  it.each(['{invalid', 'x'.repeat(16 * 1024 + 1)])(
    'rejects invalid or oversized JSON %#',
    async (json) => {
      await main(['dashboard-accounts', 'restart', '--request-json', json, '--json'])
      expect(constructorMock).not.toHaveBeenCalled()
      expect(output()).toContain(Code.InvalidRequest)
    }
  )

  it('requires a request and an absolute explicit Runtime directory', async () => {
    await main(['dashboard-accounts', 'restart', '--json'])
    expect(output()).toContain(Code.InvalidRequest)
    vi.stubEnv('ORCA_USER_DATA', 'relative-private')
    await run()
    expect(constructorMock).not.toHaveBeenCalled()
    expect(output()).not.toContain('relative-private')
  })

  it.each(['ORCA_PAIRING_CODE', 'ORCA_REMOTE_PAIRING', 'ORCA_ENVIRONMENT'])(
    'refuses ambient %s',
    async (name) => {
      vi.stubEnv(name, 'private-remote')
      await run()
      expect(constructorMock).not.toHaveBeenCalled()
      expect(output()).toContain(Code.InvalidRequest)
      expect(output()).not.toContain('private-remote')
    }
  )

  it('refuses explicit remote selection before constructing a client', async () => {
    await run(request(), ['--environment', 'private-remote'])
    expect(constructorMock).not.toHaveBeenCalled()
    expect(output()).toContain(Code.InvalidRequest)
  })

  it.each([
    { ...report(), instance_id: 'another' },
    { ...report(), runtime_id: 'another' },
    { ...report(), result: { ...report().result, acquisition_generation: 'g1' } },
    { ...report(), result: { ...report().result, fence: 7 } },
    { ...report(), result: { ...report().result, access_token: 'private-credential' } }
  ])(
    'classifies mismatched or unvalidated success as unknown, not a safe retry %#',
    async (result) => {
      callMock.mockResolvedValue({ result })
      await run()
      expect(output()).toContain(Code.OutcomeUnknown)
      expect(output()).not.toContain('private-credential')
      expect(callMock).toHaveBeenCalledOnce()
    }
  )

  it('preserves only allowlisted fixed RPC errors without error metadata', async () => {
    callMock.mockRejectedValue(
      new RuntimeRpcFailureError({
        id: 'q1',
        ok: false,
        error: {
          code: 'runtime_error',
          message: Code.ExitUnconfirmed,
          data: { credential: 'private-credential' }
        },
        _meta: { runtimeId: 'r1' }
      })
    )
    await run()
    expect(output()).toContain(Code.ExitUnconfirmed)
    expect(output()).not.toContain('private-credential')
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])).error).not.toHaveProperty(
      'data'
    )
  })

  it.each(['runtime_timeout', 'runtime_unavailable'])(
    'reports %s as unknown without automatic retry',
    async (code) => {
      callMock.mockRejectedValue(new RuntimeClientError(code, 'private-provider-and-path'))
      await run()
      expect(output()).toContain(Code.OutcomeUnknown)
      expect(output()).not.toContain('private-provider-and-path')
      expect(callMock).toHaveBeenCalledOnce()
    }
  )

  it('never accesses the ambient lazy client', async () => {
    const context: HandlerContext = {
      flags: new Map([['request-json', JSON.stringify(request())]]),
      cwd: '/tmp',
      json: false,
      get client(): never {
        throw new Error('ambient client must not be used')
      }
    }
    await DASHBOARD_ACCOUNT_HANDLERS['dashboard-accounts restart']!(context)
    expect(console.log).toHaveBeenCalledOnce()
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toEqual(report())
  })
})
