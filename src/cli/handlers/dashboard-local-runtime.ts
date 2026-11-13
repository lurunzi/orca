import { isAbsolute } from 'node:path'
import { RuntimeClientError } from '../runtime-client'

const remoteEnvironment = ['ORCA_PAIRING_CODE', 'ORCA_REMOTE_PAIRING', 'ORCA_ENVIRONMENT'] as const
export function requireLocalDashboardRuntime(
  flags: ReadonlyMap<string, string | boolean>,
  allowed: readonly string[]
): string {
  const userData = process.env.ORCA_USER_DATA
  if (
    [...flags.keys()].some((flag) => !allowed.includes(flag)) ||
    remoteEnvironment.some((name) => process.env[name]?.trim()) ||
    !userData ||
    !isAbsolute(userData) ||
    userData.includes('\0')
  ) {
    throw new RuntimeClientError('invalid_argument', 'dashboard_allocation_invalid_request')
  }
  return userData
}
