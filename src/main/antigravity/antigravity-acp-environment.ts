import { ANTIGRAVITY_BROWSER_COMMAND } from './antigravity-browser-helper'
import { agentAutoUpdateSuppressionEnv } from '../../shared/agent-launch/startup/agent-auto-update-suppression-env'
export { scrubAntigravityAcpEnvironment } from './antigravity-acp-environment-sanitizer'

// Isolate sign-in files, capture browser links and flush Python output after scrubbing inherited auth.
export const ANTIGRAVITY_ACP_ENV = {
  ...agentAutoUpdateSuppressionEnv('antigravity'),
  AGY_ACP_FORCE_FILE_STORAGE: '1',
  BROWSER: ANTIGRAVITY_BROWSER_COMMAND,
  PYTHONUNBUFFERED: '1',
  // Windows' BROWSER helper can't set Node mode inline; elsewhere it would reach agent-run commands.
  ...(process.platform === 'win32' ? { ELECTRON_RUN_AS_NODE: '1' } : {})
}
