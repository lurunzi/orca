import type { AgentChatPermissionMode } from '../../../shared/agent-launch/permissions/agent-chat-permission-mode'
import type { AcpLaunchSpec } from './acp-launch-contract'

/** The session modes a launch reports as Orca's: a full-access launch holds only that mode. */
export function acpLaunchPermissionModes(
  spec: Pick<AcpLaunchSpec, 'permissionModeConfig'>,
  fullAccess: boolean
): Readonly<Partial<Record<AgentChatPermissionMode, string>>> | undefined {
  const config = spec.permissionModeConfig
  if (!config?.fullAccessAtLaunch) {
    return config?.values
  }
  const { 'full-access': fullAccessMode, ...others } = config.values
  return fullAccess ? { 'full-access': fullAccessMode } : others
}

/** Whether a launch of `spec` runs `mode`; Orca answers a Full access the agent lacks in its ask mode. */
export function acpLaunchRunsPermissionMode(
  spec: Pick<AcpLaunchSpec, 'permissionModeConfig'>,
  mode: string
): boolean {
  const config = spec.permissionModeConfig
  const values: Readonly<Record<string, string | undefined>> = config?.values ?? {}
  return config !== undefined && (values[mode] !== undefined || mode === 'full-access')
}
