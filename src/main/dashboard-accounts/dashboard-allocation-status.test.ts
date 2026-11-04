import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDashboardAllocation } from './dashboard-allocation-reader'
import { readDashboardAllocationStatus } from './dashboard-allocation-status'
import {
  DashboardAllocationError,
  DashboardAllocationSnapshotSchema,
  DashboardAllocationStatusSchema,
  DashboardAllocationState,
  DashboardAllocationReason,
  DashboardToolProvider
} from './dashboard-allocation-protocol'

vi.mock('./dashboard-allocation-reader', () => ({ readDashboardAllocation: vi.fn() }))
afterEach(() => vi.resetAllMocks())
function snapshot(version = 1) {
  return DashboardAllocationSnapshotSchema.parse({
    schema_version: 1,
    instance_id: 'fixture-instance',
    bindings: [
      {
        provider: DashboardToolProvider.Codex,
        state: DashboardAllocationState.Available,
        account_id: 'pool-fixture',
        binding_revision: 1,
        credential_version: version,
        access_token: 'fixture-private-access',
        chatgpt_account_id: 'private-workspace',
        expires_at: null
      },
      {
        provider: DashboardToolProvider.ClaudeCode,
        state: DashboardAllocationState.Unavailable,
        account_id: 'claude-fixture',
        binding_revision: 2,
        credential_version: 3,
        reason: DashboardAllocationReason.Unverified
      }
    ]
  })
}

describe('Dashboard allocation file status', () => {
  it('projects both tools without credential material or adoption claims', async () => {
    vi.mocked(readDashboardAllocation).mockResolvedValue(snapshot())
    const status = await readDashboardAllocationStatus()
    expect(status).toEqual({
      schema_version: 1,
      instance_id: 'fixture-instance',
      process_reporting_supported: false,
      bindings: [
        {
          provider: DashboardToolProvider.Codex,
          state: DashboardAllocationState.Available,
          account_id: 'pool-fixture',
          binding_revision: 1,
          credential_version: 1,
          expires_at: null
        },
        {
          provider: DashboardToolProvider.ClaudeCode,
          state: DashboardAllocationState.Unavailable,
          account_id: 'claude-fixture',
          binding_revision: 2,
          credential_version: 3,
          reason: DashboardAllocationReason.Unverified
        }
      ]
    })
    expect(JSON.stringify(status)).not.toMatch(
      /fixture-private-access|private-workspace|access_token|chatgpt_account_id/
    )
    expect(
      DashboardAllocationStatusSchema.safeParse({ ...status, access_token: 'unaccepted' }).success
    ).toBe(false)
    expect(
      DashboardAllocationStatusSchema.safeParse({ ...status, process_reporting_supported: true })
        .success
    ).toBe(false)
  })

  it('reads each query afresh and refuses a missing pool snapshot', async () => {
    const unassigned = snapshot()
    unassigned.bindings[0] = {
      provider: DashboardToolProvider.Codex,
      state: DashboardAllocationState.Unassigned,
      account_id: null,
      binding_revision: 2,
      credential_version: 0
    }
    vi.mocked(readDashboardAllocation)
      .mockResolvedValueOnce(snapshot(2))
      .mockResolvedValueOnce(unassigned)
      .mockResolvedValueOnce(null)
    expect((await readDashboardAllocationStatus()).bindings[0].credential_version).toBe(2)
    expect((await readDashboardAllocationStatus()).bindings[0]).toEqual(unassigned.bindings[0])
    await expect(readDashboardAllocationStatus()).rejects.toThrow(
      'dashboard_allocation_unavailable'
    )
    expect(readDashboardAllocation).toHaveBeenCalledTimes(3)
  })

  it('preserves fixed reader failure without a partial result', async () => {
    vi.mocked(readDashboardAllocation).mockRejectedValue(new DashboardAllocationError())
    await expect(readDashboardAllocationStatus()).rejects.toThrow(
      'dashboard_allocation_unavailable'
    )
  })
})
