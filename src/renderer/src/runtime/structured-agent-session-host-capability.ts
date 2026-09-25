// Whether a structured-session host negotiated one capability, read through the runtime's cache.

import {
  AGENT_SESSION_HANDOFF_CONTROLS_RUNTIME_CAPABILITY,
  type RuntimeCapability
} from '../../../shared/protocol-version'
import {
  runtimeEnvironmentSupportsCapability,
  type RuntimeClientTarget
} from './runtime-rpc-client'
import {
  ensureLocalRuntimeCapabilities,
  readLocalRuntimeCapabilitiesOrUnknown
} from './local-runtime-capabilities'

/** Read a capability through the runtime's existing status cache. A failed/unknown
 *  probe is treated as legacy so a newer call is never made before the host has
 *  proved it understands it. */
export async function structuredAgentSessionHostSupports(
  target: RuntimeClientTarget,
  capability: RuntimeCapability
): Promise<boolean> {
  try {
    if (target.kind === 'local') {
      const known = readLocalRuntimeCapabilitiesOrUnknown()
      const capabilities = known ?? (await ensureLocalRuntimeCapabilities())
      return capabilities?.includes(capability) === true
    }
    return await runtimeEnvironmentSupportsCapability(target.environmentId, capability)
  } catch {
    return false
  }
}

/** Gates chat/terminal switching and reservation release; unknown answers as unsupported. */
export function supportsStructuredAgentSessionHandoffControls(
  target: RuntimeClientTarget
): Promise<boolean> {
  return structuredAgentSessionHostSupports(
    target,
    AGENT_SESSION_HANDOFF_CONTROLS_RUNTIME_CAPABILITY
  )
}
