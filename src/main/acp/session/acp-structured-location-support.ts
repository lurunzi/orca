import type { AgentSessionExecutionLocation } from '../../../shared/agent-session/lifecycle/agent-session-record'
import { supportsSupervisedProviderChildLocation } from '../../provider-process/supervised-provider-child-location'
import type { AcpLaunchSpec } from '../launch/acp-launch-contract'

export function supportsAcpStructuredLocation(
  spec: AcpLaunchSpec,
  location: AgentSessionExecutionLocation,
  hasWindowsProcessStartTimeProof?: () => boolean
): boolean {
  return (
    supportsSupervisedProviderChildLocation(location, hasWindowsProcessStartTimeProof) &&
    // A host backend can serve chats where the managed program has no build.
    (!spec.managedRuntime || spec.managedRuntime.pin() !== null || spec.hostBackend !== undefined)
  )
}
