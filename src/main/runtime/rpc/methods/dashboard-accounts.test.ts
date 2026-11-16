import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import {
  DashboardToolProvider,
  DashboardAllocationState
} from '../../../dashboard-accounts/dashboard-allocation-protocol'
import { DASHBOARD_ACCOUNT_METHODS } from './dashboard-accounts'
import { DashboardCodexRefreshSource } from '../../../dashboard-accounts/dashboard-codex-refresh-protocol'
import { readDashboardAllocationStatus } from '../../../dashboard-accounts/dashboard-allocation-status'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/host/structured-agent-session-registry'

vi.mock('../../../dashboard-accounts/dashboard-allocation-status', () => ({
  readDashboardAllocationStatus: vi.fn()
}))
vi.mock('../../../native-chat/agent-session-wire/host/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: vi.fn()
}))
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})
const method = DASHBOARD_ACCOUNT_METHODS[0]
const processes = DASHBOARD_ACCOUNT_METHODS[1]
const refreshes = DASHBOARD_ACCOUNT_METHODS[2]
function context(identity: Pick<RpcContext, 'caller' | 'clientKind'>): RpcContext {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: handlers read only the transport identity and Runtime id.
  return { ...identity, runtime: { getRuntimeId: () => 'fixture-runtime' } } as RpcContext
}
const refused: Pick<RpcContext, 'caller' | 'clientKind'>[] = [
  {},
  { caller: { kind: 'desktop' } },
  { caller: { kind: 'paired-device', deviceId: 'fixture-device' } },
  { caller: { kind: 'local-cli' }, clientKind: 'runtime' },
  { caller: { kind: 'local-cli' }, clientKind: 'mobile' }
]

describe('local Dashboard account RPC', () => {
  it.skipIf(process.platform !== 'linux')(
    'reports an uninstalled adapter as unsupported',
    async () => {
      vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'fixture-instance')
      vi.mocked(getStructuredAgentSessionHost).mockReturnValue(null)
      await expect(
        processes.handler({}, context({ caller: { kind: 'local-cli' } }))
      ).resolves.toEqual({
        schema_version: 1,
        instance_id: 'fixture-instance',
        runtime_id: 'fixture-runtime',
        supported: false
      })
      expect(processes.name).toBe('dashboard.accounts.codexProcesses')
      expect(processes.permission).toBe('accounts-admin')
      expect(processes.params.safeParse({ path: '/unaccepted' }).success).toBe(false)
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'reads only the installed Codex adapter current report',
    async () => {
      vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'fixture-instance')
      const read = vi.fn(() => ({ pending_acquisitions: 1, processes: [] }))
      const registration = vi.fn(() => ({ adapter: { readDashboardCodexProcesses: read } }))
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only this registry lookup and report method.
      vi.mocked(getStructuredAgentSessionHost).mockReturnValue({
        deps: { agents: { registration } }
      } as never)
      await expect(
        processes.handler({}, context({ caller: { kind: 'local-cli' } }))
      ).resolves.toEqual({
        schema_version: 1,
        instance_id: 'fixture-instance',
        runtime_id: 'fixture-runtime',
        supported: true,
        pending_acquisitions: 1,
        processes: []
      })
      expect(registration).toHaveBeenCalledWith(DashboardToolProvider.Codex)
      expect(read).toHaveBeenCalledOnce()
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'keeps uninstalled refresh observation distinct from an empty request list',
    async () => {
      vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'fixture-instance')
      vi.mocked(getStructuredAgentSessionHost).mockReturnValue(null)
      await expect(
        refreshes.handler({}, context({ caller: { kind: 'local-cli' } }))
      ).resolves.toEqual({
        schema_version: 2,
        instance_id: 'fixture-instance',
        runtime_id: 'fixture-runtime',
        supported: false
      })
      const read = vi.fn(() => ({ requests: [] }))
      const registration = vi.fn(() => ({ adapter: { readDashboardCodexRefreshes: read } }))
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler uses only the Codex registration and report method.
      vi.mocked(getStructuredAgentSessionHost).mockReturnValue({
        deps: { agents: { registration } }
      } as never)
      await expect(
        refreshes.handler({}, context({ caller: { kind: 'local-cli' } }))
      ).resolves.toEqual({
        schema_version: 2,
        instance_id: 'fixture-instance',
        runtime_id: 'fixture-runtime',
        supported: true,
        requests: []
      })
      expect(registration).toHaveBeenCalledExactlyOnceWith(DashboardToolProvider.Codex)
      expect(read).toHaveBeenCalledOnce()
      expect(refreshes.name).toBe('dashboard.accounts.codexRefreshes')
      expect(refreshes.permission).toBe('accounts-admin')
      expect(refreshes.params.safeParse({ path: '/unaccepted' }).success).toBe(false)
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'returns current refresh metadata through the strict response schema',
    async () => {
      vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'fixture-instance')
      const requests = [
        {
          request_id: 'request-fixture',
          provider: DashboardToolProvider.Codex,
          source: DashboardCodexRefreshSource.Session,
          session_id: 'session-fixture',
          fence: 7,
          acquisition_generation: 'generation-fixture',
          process: {
            hostId: 'host-fixture',
            pid: 42,
            processStartTimeMs: null,
            spawnToken: 'spawn-fixture'
          },
          account_id: 'pool-fixture',
          binding_revision: 2,
          credential_version: 3,
          deadline_at: 1700000009000
        }
      ]
      const read = vi.fn(() => ({ requests }))
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler uses only the Codex registration and report method.
      vi.mocked(getStructuredAgentSessionHost).mockReturnValue({
        deps: {
          agents: { registration: () => ({ adapter: { readDashboardCodexRefreshes: read } }) }
        }
      } as never)
      await expect(
        refreshes.handler({}, context({ caller: { kind: 'local-cli' } }))
      ).resolves.toEqual({
        schema_version: 2,
        instance_id: 'fixture-instance',
        runtime_id: 'fixture-runtime',
        supported: true,
        requests
      })
    }
  )

  it.skipIf(process.platform !== 'linux')(
    'scrubs refresh query errors and unexpected credential fields',
    async () => {
      vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'fixture-instance')
      const read = vi.fn(() => ({ requests: [], access_token: 'private-access' }))
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the invalid report intentionally exercises the runtime schema boundary.
      vi.mocked(getStructuredAgentSessionHost).mockReturnValue({
        deps: {
          agents: { registration: () => ({ adapter: { readDashboardCodexRefreshes: read } }) }
        }
      } as never)
      await expect(
        refreshes.handler({}, context({ caller: { kind: 'local-cli' } }))
      ).rejects.toThrow('dashboard_allocation_unavailable')
      read.mockImplementationOnce(() => {
        throw new Error('private-access private-path')
      })
      await expect(
        refreshes.handler({}, context({ caller: { kind: 'local-cli' } }))
      ).rejects.toThrow('dashboard_allocation_unavailable')
    }
  )

  it('refuses Codex reports outside a configured Linux pool Runtime', async () => {
    vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', undefined)
    for (const candidate of [processes, refreshes]) {
      await expect(
        candidate.handler({}, context({ caller: { kind: 'local-cli' } }))
      ).rejects.toThrow('dashboard_allocation_unavailable')
    }
    expect(getStructuredAgentSessionHost).not.toHaveBeenCalled()
  })

  it('only reads status for transport-confirmed local CLI calls', async () => {
    vi.mocked(readDashboardAllocationStatus).mockResolvedValue({
      schema_version: 1,
      instance_id: 'fixture-instance',
      process_reporting_supported: false,
      bindings: [
        {
          provider: DashboardToolProvider.Codex,
          state: DashboardAllocationState.Unassigned,
          account_id: null,
          binding_revision: 0,
          credential_version: 0
        },
        {
          provider: DashboardToolProvider.ClaudeCode,
          state: DashboardAllocationState.Unassigned,
          account_id: null,
          binding_revision: 0,
          credential_version: 0
        }
      ]
    })
    expect(method.name).toBe('dashboard.accounts.status')
    expect(method.permission).toBe('accounts-admin')
    await expect(
      method.handler({}, context({ caller: { kind: 'local-cli' } }))
    ).resolves.toMatchObject({ process_reporting_supported: false })
    expect(readDashboardAllocationStatus).toHaveBeenCalledOnce()
    expect(method.params.safeParse({ path: '/unaccepted' }).success).toBe(false)
  })

  it.each(refused)(
    'refuses non-local transport identity %# before reading credentials',
    async (identity) => {
      for (const candidate of [method, processes, refreshes, DASHBOARD_ACCOUNT_METHODS[3]]) {
        await expect(candidate.handler({}, context(identity))).rejects.toThrow(
          'dashboard_allocation_unavailable'
        )
      }
      expect(readDashboardAllocationStatus).not.toHaveBeenCalled()
      expect(getStructuredAgentSessionHost).not.toHaveBeenCalled()
    }
  )
})
