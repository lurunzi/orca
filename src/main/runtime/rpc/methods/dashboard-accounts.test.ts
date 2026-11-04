import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import {
  DashboardToolProvider,
  DashboardAllocationState
} from '../../../dashboard-accounts/dashboard-allocation-protocol'
import { DASHBOARD_ACCOUNT_METHODS } from './dashboard-accounts'
import { readDashboardAllocationStatus } from '../../../dashboard-accounts/dashboard-allocation-status'

vi.mock('../../../dashboard-accounts/dashboard-allocation-status', () => ({
  readDashboardAllocationStatus: vi.fn()
}))
afterEach(() => vi.resetAllMocks())
const method = DASHBOARD_ACCOUNT_METHODS[0]
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
      await expect(method.handler({}, context(identity))).rejects.toThrow(
        'dashboard_allocation_unavailable'
      )
      expect(readDashboardAllocationStatus).not.toHaveBeenCalled()
    }
  )
})
