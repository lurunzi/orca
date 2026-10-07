import { agentModelCatalogSessionAccess } from '../native-chat/agent-model-catalog/agent-model-catalog-fingerprint'
import type { ClaudeStructuredLaunch } from './claude-structured-launch-resolution'
import type {
  ClaudeSession,
  ClaudeStructuredSessionAdapterDeps
} from './claude-structured-session-state'

export function configureClaudeSessionAccountContext(
  session: ClaudeSession,
  launch: ClaudeStructuredLaunch,
  deps: Pick<ClaudeStructuredSessionAdapterDeps, 'modelCatalog' | 'readFastModeAccountSupport'>
): void {
  session.catalogAccess = agentModelCatalogSessionAccess(
    deps.modelCatalog,
    'claude',
    launch.claudeConfigDir
  )
  const read = deps.readFastModeAccountSupport
  if (read) {
    session.readFastModeAccountSupport = async (settings, timeoutMs) =>
      read(launch, settings, timeoutMs, await session.connection.initializationResult())
  }
}
