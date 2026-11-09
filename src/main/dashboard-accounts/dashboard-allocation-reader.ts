import { constants, type Stats } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DASHBOARD_ALLOCATION_LIMIT_BYTES,
  DashboardAllocationError,
  DashboardAllocationState,
  parseDashboardAllocation,
  type DashboardAllocationSnapshot,
  type DashboardCodexAllocation,
  type DashboardClaudeAllocation
} from './dashboard-allocation-protocol'

const directory = '/run/orca-dashboard'
const file = join(directory, 'desired-accounts.json')
function requireOwnership(stat: Stats, mode: number): void {
  if (stat.uid !== 0 || stat.gid !== 1000 || (stat.mode & 0o777) !== mode) {
    throw new DashboardAllocationError()
  }
}
export async function readDashboardAllocation(): Promise<DashboardAllocationSnapshot | null> {
  const instanceId = process.env.ORCA_DASHBOARD_INSTANCE_ID
  if (instanceId === undefined) {
    return null
  }
  if (process.platform !== 'linux' || !instanceId || instanceId.length > 128) {
    throw new DashboardAllocationError()
  }
  try {
    const parent = await lstat(directory)
    requireOwnership(parent, 0o750)
    if (!parent.isDirectory() || parent.isSymbolicLink()) {
      throw new DashboardAllocationError()
    }
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      requireOwnership(stat, 0o640)
      if (!stat.isFile() || stat.size > DASHBOARD_ALLOCATION_LIMIT_BYTES) {
        throw new DashboardAllocationError()
      }
      const body = await handle.readFile()
      if (body.length > DASHBOARD_ALLOCATION_LIMIT_BYTES) {
        throw new DashboardAllocationError()
      }
      return parseDashboardAllocation(JSON.parse(body.toString('utf8')), instanceId)
    } finally {
      await handle.close()
    }
  } catch {
    throw new DashboardAllocationError()
  }
}
export type DashboardCodexAllocationContext = {
  instanceId: string
  allocation: DashboardCodexAllocation
}
export async function readDashboardCodexAllocationContext(): Promise<DashboardCodexAllocationContext | null> {
  const snapshot = await readDashboardAllocation()
  if (!snapshot) {
    return null
  }
  const binding = snapshot.bindings[0]
  requireAvailableAllocation(binding)
  return { instanceId: snapshot.instance_id, allocation: binding }
}
export async function readDashboardCodexAllocation(): Promise<DashboardCodexAllocation | null> {
  return (await readDashboardCodexAllocationContext())?.allocation ?? null
}
function requireAvailableAllocation(
  binding: DashboardAllocationSnapshot['bindings'][number]
): asserts binding is DashboardCodexAllocation | DashboardClaudeAllocation {
  if (
    binding.state !== DashboardAllocationState.Available ||
    (binding.expires_at !== null &&
      (!Number.isFinite(Date.parse(binding.expires_at)) ||
        Date.parse(binding.expires_at) <= Date.now()))
  ) {
    throw new DashboardAllocationError()
  }
}
export async function readDashboardClaudeAllocation(): Promise<DashboardClaudeAllocation | null> {
  const snapshot = await readDashboardAllocation()
  if (!snapshot) {
    return null
  }
  const binding = snapshot.bindings[1]
  requireAvailableAllocation(binding)
  return binding
}
