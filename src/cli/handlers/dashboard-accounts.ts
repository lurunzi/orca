import { isAbsolute } from 'node:path'
import {
  DashboardAllocationErrorCode,
  DashboardAllocationStatusSchema
} from '../../main/dashboard-accounts/dashboard-allocation-protocol'
import type { CommandHandler } from '../dispatch'
import { RuntimeClient, RuntimeClientError } from '../runtime-client'

const remoteEnvironment = ['ORCA_PAIRING_CODE', 'ORCA_REMOTE_PAIRING', 'ORCA_ENVIRONMENT'] as const
const invalidRequest = () =>
  new RuntimeClientError('invalid_argument', 'dashboard_allocation_invalid_request')

export const DASHBOARD_ACCOUNT_HANDLERS: Record<string, CommandHandler> = {
  'dashboard-accounts status': async ({ flags }) => {
    if (
      [...flags.keys()].some((flag) => flag !== 'json' && flag !== 'help') ||
      remoteEnvironment.some((name) => process.env[name]?.trim())
    ) {
      throw invalidRequest()
    }
    const userData = process.env.ORCA_USER_DATA
    if (!userData || !isAbsolute(userData) || userData.includes('\0')) {
      throw invalidRequest()
    }
    try {
      const client = new RuntimeClient(userData, 10_000, null, null)
      const response = await client.call<unknown>('dashboard.accounts.status', {})
      const status = DashboardAllocationStatusSchema.safeParse(response.result)
      if (!status.success) {
        throw new Error('Invalid allocation status')
      }
      console.log(JSON.stringify(status.data))
    } catch {
      throw new RuntimeClientError(
        DashboardAllocationErrorCode.Unavailable,
        DashboardAllocationErrorCode.Unavailable
      )
    }
  }
}
