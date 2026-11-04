import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from './index'
import { HANDLER_COMMAND_KEYS, type HandlerContext } from './dispatch'
import { DASHBOARD_ACCOUNT_HANDLERS } from './handlers/dashboard-accounts'
import { COMMAND_SPECS } from './specs'
import { ignoresRemoteSelection } from './remote-selection-scope'
import {
  DashboardAllocationState,
  DashboardToolProvider
} from '../main/dashboard-accounts/dashboard-allocation-protocol'

const { callMock, constructorMock } = vi.hoisted(() => ({
  callMock: vi.fn(),
  constructorMock: vi.fn()
}))
vi.mock('./runtime-client', async () => {
  const { RuntimeClientError, RuntimeRpcFailureError } = await import('./runtime/types')
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

function allocationStatus() {
  return {
    schema_version: 1,
    instance_id: 'instance-fixture',
    process_reporting_supported: false,
    bindings: [
      {
        provider: DashboardToolProvider.Codex,
        state: DashboardAllocationState.Available,
        account_id: 'codex-fixture',
        binding_revision: 2,
        credential_version: 3,
        expires_at: null
      },
      {
        provider: DashboardToolProvider.ClaudeCode,
        state: DashboardAllocationState.Unassigned,
        account_id: null,
        binding_revision: 0,
        credential_version: 0
      }
    ]
  }
}
const originalExitCode = process.exitCode
beforeEach(() => {
  vi.stubEnv('ORCA_PAIRING_CODE', '')
  vi.stubEnv('ORCA_REMOTE_PAIRING', '')
  vi.stubEnv('ORCA_ENVIRONMENT', '')
  vi.stubEnv('ORCA_USER_DATA', '/tmp/dashboard-runtime')
  vi.stubEnv('ORCA_USER_DATA_PATH', '/tmp/wrong-runtime')
  constructorMock.mockClear()
  callMock
    .mockReset()
    .mockResolvedValue({ result: allocationStatus(), _meta: { authToken: 'private-token' } })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  process.exitCode = originalExitCode
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('local Dashboard allocation status command', () => {
  it('uses the explicit Runtime directory, local client and fixed empty-parameter RPC', async () => {
    await main(['dashboard-accounts', 'status', '--json'])
    expect(constructorMock).toHaveBeenCalledExactlyOnceWith(
      '/tmp/dashboard-runtime',
      10_000,
      null,
      null
    )
    expect(callMock).toHaveBeenCalledExactlyOnceWith('dashboard.accounts.status', {})
    expect(console.log).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toEqual(
      allocationStatus()
    )
    expect(console.error).not.toHaveBeenCalled()
  })

  it('queries Codex process adoption through the same fixed local transport', async () => {
    const result = {
      schema_version: 1,
      instance_id: 'instance-fixture',
      runtime_id: 'runtime-fixture',
      supported: true,
      pending_acquisitions: 1,
      processes: []
    }
    callMock.mockResolvedValue({ result, _meta: { authToken: 'private-token' } })
    await main(['dashboard-accounts', 'codex-processes', '--json'])
    expect(constructorMock).toHaveBeenCalledExactlyOnceWith(
      '/tmp/dashboard-runtime',
      10_000,
      null,
      null
    )
    expect(callMock).toHaveBeenCalledExactlyOnceWith('dashboard.accounts.codexProcesses', {})
    expect(console.log).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toEqual(result)
  })

  it('keeps an unavailable Codex adapter distinct from an empty process report', async () => {
    const result = {
      schema_version: 1,
      instance_id: 'instance-fixture',
      runtime_id: 'runtime-fixture',
      supported: false
    }
    callMock.mockResolvedValue({ result })
    await main(['dashboard-accounts', 'codex-processes', '--json'])
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toEqual(result)
    expect(HANDLER_COMMAND_KEYS.has('dashboard-accounts codex-processes')).toBe(true)
    expect(
      COMMAND_SPECS.some((spec) => spec.path.join(' ') === 'dashboard-accounts codex-processes')
    ).toBe(true)
  })

  it('refuses process responses containing raw credentials', async () => {
    callMock.mockResolvedValue({
      result: {
        schema_version: 1,
        instance_id: 'instance-fixture',
        runtime_id: 'runtime-fixture',
        supported: false,
        access_token: 'private-access'
      }
    })
    await main(['dashboard-accounts', 'codex-processes', '--json'])
    const output = JSON.stringify(vi.mocked(console.log).mock.calls)
    expect(output).toContain('dashboard_allocation_unavailable')
    expect(output).not.toContain('private-access')
  })

  it('also emits only validated JSON without --json', async () => {
    await main(['dashboard-accounts', 'status'])
    expect(console.log).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toEqual(
      allocationStatus()
    )
  })

  it.each(['environment', 'pairing-code', 'host'])(
    'rejects explicit --%s before creating a client',
    async (flag) => {
      await main(['dashboard-accounts', 'status', `--${flag}`, 'private-remote', '--json'])
      expect(constructorMock).not.toHaveBeenCalled()
      expect(callMock).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    }
  )

  it.each(['ORCA_PAIRING_CODE', 'ORCA_REMOTE_PAIRING', 'ORCA_ENVIRONMENT'])(
    'rejects nonempty %s without remote lookup',
    async (name) => {
      vi.stubEnv(name, 'private-remote')
      await main(['dashboard-accounts', 'status', '--json'])
      expect(constructorMock).not.toHaveBeenCalled()
      expect(callMock).not.toHaveBeenCalled()
      expect(console.log).toHaveBeenCalled()
      expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('private-remote')
    }
  )

  it.each([undefined, '', 'relative/private-path'])(
    'rejects an invalid Runtime directory without connecting',
    async (directory) => {
      vi.stubEnv('ORCA_USER_DATA', directory)
      await main(['dashboard-accounts', 'status', '--json'])
      expect(constructorMock).not.toHaveBeenCalled()
      expect(console.log).toHaveBeenCalled()
      expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
        'relative/private-path'
      )
    }
  )

  it('replaces transport errors and their metadata with a fixed error', async () => {
    callMock.mockRejectedValue(new Error('/private/runtime-path private-auth-token'))
    await main(['dashboard-accounts', 'status', '--json'])
    expect(console.log).toHaveBeenCalledTimes(1)
    const output = JSON.stringify(vi.mocked(console.log).mock.calls)
    expect(output).toContain('dashboard_allocation_unavailable')
    expect(output).not.toMatch(/private\/runtime-path|private-auth-token/)
  })

  it('rejects unknown response fields instead of printing a credential or claiming adoption', async () => {
    callMock.mockResolvedValue({
      result: { ...allocationStatus(), access_token: 'private-access' }
    })
    await main(['dashboard-accounts', 'status', '--json'])
    expect(console.log).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).toContain(
      'dashboard_allocation_unavailable'
    )
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('private-access')
  })

  it('keeps specification, manifest and local-selection registration aligned', () => {
    expect(
      COMMAND_SPECS.find((spec) => spec.path.join(' ') === 'dashboard-accounts status')
    ).toMatchObject({
      allowedFlags: ['help', 'json'],
      usage: 'orca dashboard-accounts status [--json]'
    })
    expect(HANDLER_COMMAND_KEYS.has('dashboard-accounts status')).toBe(true)
    expect(ignoresRemoteSelection(['dashboard-accounts', 'status'])).toBe(true)
  })

  it('never accesses the ambient lazy client', async () => {
    const context: HandlerContext = {
      flags: new Map(),
      cwd: '/tmp',
      json: false,
      get client(): never {
        throw new Error('Ambient client must not be used')
      }
    }
    await DASHBOARD_ACCOUNT_HANDLERS['dashboard-accounts status']!(context)
    expect(console.log).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toEqual(
      allocationStatus()
    )
  })
})
