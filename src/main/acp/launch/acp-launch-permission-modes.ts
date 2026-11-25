import type {
  AgentChatPermissionChoice,
  AgentChatPermissionMode
} from '../../../shared/agent-launch/permissions/agent-chat-permission-mode'
import type { AcpLaunchSpec } from './acp-launch-contract'

/** The session modes a launch reports as Orca's: a full-access launch holds only that mode. */
function acpLaunchPermissionModes(
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

/** A launch's permission facts: Orca's session modes, the starting choice, and whether the agent's
 *  own arguments hold full access, which only a restart can take away. */
export function acpLaunchPermission(
  spec: Pick<AcpLaunchSpec, 'permissionModeConfig' | 'args'>,
  fullAccess: boolean,
  permission: AgentChatPermissionChoice | undefined
) {
  const args = (grant: boolean) => spec.args({ fullAccess: grant, pluginDirs: [] }).join('\0')
  return {
    permissionModes: acpLaunchPermissionModes(spec, fullAccess),
    permission: permission ?? 'ask',
    launchArgsGrantFullAccess: fullAccess && args(true) !== args(false)
  }
}

/** Whether Orca answers the agent's permission requests itself under full access: the agent has
 *  no full-access mode of its own, or its modes govern only some requests. */
function acpAnswersRequests(spec: Pick<AcpLaunchSpec, 'permissionModeConfig'>) {
  const config = spec.permissionModeConfig
  return !config || config.fullAccessAnswersRequests === true || !config.values['full-access']
}

export const acpOrcaApprovals = {
  /** Whether Orca answers `request`; a mode change, such as leaving plan mode, is the person's. */
  answers(
    session: {
      spec: Pick<AcpLaunchSpec, 'permissionModeConfig'>
      permission: AgentChatPermissionChoice
    },
    request: { toolCall: { kind?: string | null } }
  ): boolean {
    return (
      session.permission === 'full-access' &&
      acpAnswersRequests(session.spec) &&
      request.toolCall.kind !== 'switch_mode'
    )
  },
  /** Whether Orca, not the agent, reports the launch's permission mode. */
  reports(spec: Pick<AcpLaunchSpec, 'permissionModeConfig'>, fullAccess: boolean): boolean {
    const config = spec.permissionModeConfig
    return !config || (fullAccess && !config.values['full-access'])
  }
}
