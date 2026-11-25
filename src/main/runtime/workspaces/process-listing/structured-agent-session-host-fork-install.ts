import { ensureStructuredAgentSessionHost } from '../../agent-session/installation/structured-agent-session-runtime'
import type { StructuredAgentSessionRuntimeDeps } from '../../agent-session/installation/structured-agent-session-runtime-contract'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import * as sessionIdentity from '../../structured-session-coordinator-identity'

type ForkStructuredAgentSessionHostRuntime = Parameters<
  typeof sessionIdentity.bindRuntimeStructuredSessionCoordinatorIdentities
>[0] & { requireStore(): RuntimeStore }

/** Fork: the host install plus coordinator identities and account-switch settings. */
export async function ensureForkStructuredAgentSessionHost(
  runtime: ForkStructuredAgentSessionHostRuntime,
  deps: StructuredAgentSessionRuntimeDeps | (() => StructuredAgentSessionRuntimeDeps)
): Promise<void> {
  // Install BEFORE the host: host install can resume sessions that need their identity.
  sessionIdentity.installStructuredSessionIdentityLoader(() => runtime.getExistingOrchestrationDb())
  await ensureStructuredAgentSessionHost(() => ({
    ...(typeof deps === 'function' ? deps() : deps),
    accountSwitchSettings: () => runtime.requireStore().getSettings()
  }))
  sessionIdentity.bindRuntimeStructuredSessionCoordinatorIdentities(runtime)
}
