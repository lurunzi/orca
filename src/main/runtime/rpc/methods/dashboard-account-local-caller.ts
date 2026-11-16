import type { RpcContext } from '../core'
import { DashboardAllocationError } from '../../../dashboard-accounts/dashboard-allocation-protocol'

export function requireLocalDashboardCaller({
  caller,
  clientKind
}: Pick<RpcContext, 'caller' | 'clientKind'>): void {
  if (caller?.kind !== 'local-cli' || clientKind !== undefined) {
    throw new DashboardAllocationError()
  }
}
