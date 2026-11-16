import { readDashboardAllocation } from './dashboard-allocation-reader'
import {
  DashboardAllocationError,
  DashboardAllocationState,
  DashboardAllocationStatusSchema,
  type DashboardAllocationStatus
} from './dashboard-allocation-protocol'

export async function readDashboardAllocationStatus(): Promise<DashboardAllocationStatus> {
  const snapshot = await readDashboardAllocation()
  if (!snapshot) {
    throw new DashboardAllocationError()
  }
  const bindings = snapshot.bindings.map((binding) => {
    const metadata = {
      provider: binding.provider,
      state: binding.state,
      account_id: binding.account_id,
      binding_revision: binding.binding_revision,
      credential_version: binding.credential_version
    }
    if (binding.state === DashboardAllocationState.Unavailable) {
      return { ...metadata, reason: binding.reason }
    }
    if (binding.state === DashboardAllocationState.Available) {
      return { ...metadata, expires_at: binding.expires_at }
    }
    return metadata
  })
  return DashboardAllocationStatusSchema.parse({
    schema_version: 1,
    instance_id: snapshot.instance_id,
    bindings,
    process_reporting_supported: false
  })
}
