import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import {
  DashboardToolProvider,
  DashboardAllocationState
} from '../../../dashboard-accounts/dashboard-allocation-protocol'
import { DASHBOARD_ACCOUNT_METHODS } from './dashboard-accounts'
import { readDashboardAllocationStatus } from '../../../dashboard-accounts/dashboard-allocation-status'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'

vi.mock('../../../dashboard-accounts/dashboard-allocation-status', () => ({
  readDashboardAllocationStatus: vi.fn()
}))
vi.mock('../../../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: vi.fn()
}))
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})
const method = DASHBOARD_ACCOUNT_METHODS[0]
const processes = DASHBOARD_ACCOUNT_METHODS[1]
function context(identity: Pick<RpcContext, 'caller' | 'clientKind'>): RpcContext {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this method reads only the transport identity.
  return identity as RpcContext
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
        supported: true,
        pending_acquisitions: 1,
        processes: []
      })
      expect(registration).toHaveBeenCalledWith(DashboardToolProvider.Codex)
      expect(read).toHaveBeenCalledOnce()
    }
  )

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
      for (const candidate of DASHBOARD_ACCOUNT_METHODS) {
        await expect(candidate.handler({}, context(identity))).rejects.toThrow(
          'dashboard_allocation_unavailable'
        )
      }
      expect(readDashboardAllocationStatus).not.toHaveBeenCalled()
      expect(getStructuredAgentSessionHost).not.toHaveBeenCalled()
    }
  )
})
