import type { PreloadApi } from '../../../../preload/api-types'
import { omitPairingLocalUiFields } from '../../../../shared/pairing-local-ui-fields'
import type { createWebExplorerRootSync } from './web-explorer-root-sync'
import { requireActiveEnvironmentOrNull } from './web-runtime-session'
import { prepareHostUiUpdates } from './web-status-bar-host-updates'

/** Captures the target host and strips browser-local or unsupported fields before sending a UI update. */
export async function prepareWebHostUiUpdates(
  explorerRoots: Pick<ReturnType<typeof createWebExplorerRootSync>, 'prepare'>,
  updates: Parameters<PreloadApi['ui']['set']>[0]
) {
  const environmentId = requireActiveEnvironmentOrNull()?.id
  const hostUpdates = omitPairingLocalUiFields(updates)
  // Synchronous so the pending-root queue keeps call order; the status-bar probe awaits after.
  explorerRoots.prepare(environmentId, hostUpdates)
  return { environmentId, hostUpdates: await prepareHostUiUpdates(hostUpdates) }
}
