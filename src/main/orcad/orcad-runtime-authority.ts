import process from 'node:process'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { OrcadFeatureReadiness } from '../runtime/rpc/orcad-feature-readiness'
import type { createOrcadStartupTiming } from './orcad-startup-timing'
import { restoreOrcadTerminalAuthority } from './orcad-restored-terminal-authority'

export async function restoreOrcadRuntimeAuthority(
  runtime: OrcaRuntimeService,
  timed: ReturnType<typeof createOrcadStartupTiming>['time'],
  readiness: OrcadFeatureReadiness
): Promise<void> {
  await restoreOrcadTerminalAuthority(runtime, timed, readiness)
  if (process.platform === 'linux' && process.env.ORCA_DASHBOARD_INSTANCE_ID) {
    await timed('dashboard-accounts', () => runtime.ensureStructuredAgentSessionHost())
  }
}
