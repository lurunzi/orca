import { z } from 'zod'
import { defineMethod } from '../core'
import { DashboardAllocationError } from '../../../dashboard-accounts/dashboard-allocation-protocol'
import { readDashboardAllocationStatus } from '../../../dashboard-accounts/dashboard-allocation-status'

export const DASHBOARD_ACCOUNT_METHODS = [
  defineMethod({
    name: 'dashboard.accounts.status',
    permission: 'accounts-admin',
    params: z.strictObject({}),
    handler: async (_, { caller, clientKind }) => {
      if (caller?.kind !== 'local-cli' || clientKind !== undefined) {
        throw new DashboardAllocationError()
      }
      return readDashboardAllocationStatus()
    }
  })
] as const
