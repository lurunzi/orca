import {
  DashboardAllocationError,
  DashboardAllocationSnapshotSchema
} from './dashboard-allocation-protocol'

export function readDashboardInstanceId(): string | undefined {
  const value = process.env.ORCA_DASHBOARD_INSTANCE_ID
  if (value === undefined) {
    return undefined
  }
  const parsed = DashboardAllocationSnapshotSchema.shape.instance_id.safeParse(value)
  if (!parsed.success) {
    throw new DashboardAllocationError()
  }
  return parsed.data
}
