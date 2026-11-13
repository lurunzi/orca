import { expect, it } from 'vitest'
import {
  DashboardAllocationErrorCode,
  DashboardAllocationSnapshotSchema,
  parseDashboardAllocation
} from './dashboard-allocation-protocol'

function allocationFixture() {
  return {
    schema_version: 1,
    instance_id: 'fixture-instance',
    bindings: [
      {
        provider: 'codex',
        state: 'unassigned',
        account_id: null,
        binding_revision: 0,
        credential_version: 0
      },
      {
        provider: 'claude_code',
        state: 'available',
        account_id: 'fixture-pool',
        binding_revision: 1,
        credential_version: 1,
        access_token: 'fixture-private-access',
        expires_at: null
      }
    ]
  }
}
it('accepts the shared snapshot frame and rejects wrong instances, provider order and secret extras', () => {
  const fixture = allocationFixture()
  expect(parseDashboardAllocation(fixture, 'fixture-instance')).toEqual(fixture)
  expect(() => parseDashboardAllocation(fixture, 'other')).toThrow(
    DashboardAllocationErrorCode.Unavailable
  )
  expect(
    DashboardAllocationSnapshotSchema.safeParse({
      ...fixture,
      bindings: fixture.bindings.toReversed()
    }).success
  ).toBe(false)
  const malformed = {
    ...fixture,
    bindings: [fixture.bindings[0], { ...fixture.bindings[1], refresh_token: 'forbidden-refresh' }]
  }
  expect(() => parseDashboardAllocation(malformed, 'fixture-instance')).toThrow(
    DashboardAllocationErrorCode.Unavailable
  )
  try {
    parseDashboardAllocation(malformed, 'fixture-instance')
  } catch (error) {
    expect(String(error)).not.toMatch(/fixture-private-access|forbidden-refresh/)
  }
})
