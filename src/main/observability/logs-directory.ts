import { getAppEnvironment, hasAppEnvironment } from '../../shared/app-environment'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { PRODUCT_IDENTITY } from '../../shared/product-identity'

// Use the environment port for plain Node hosts. Keep userData/logs on macOS
// because Electron’s logs path would strand existing bundles.
function getUserDataDir(): string {
  if (hasAppEnvironment()) {
    return getAppEnvironment().getPath('userData')
  }
  const home = homedir()
  if (platform() === 'darwin') {
    return join(home, 'Library', 'Application Support', PRODUCT_IDENTITY.dataDirName)
  }
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? home, PRODUCT_IDENTITY.dataDirName)
  }
  return join(home, '.config', PRODUCT_IDENTITY.dataDirName)
}

export function getLogsDirectory(): string {
  return join(getUserDataDir(), 'logs')
}

export function getTraceFilePath(): string {
  return join(getLogsDirectory(), 'main.trace.ndjson')
}

export function getOrcadTraceFilePath(): string {
  return join(getLogsDirectory(), 'orcad.trace.ndjson')
}

export function getDaemonLogFilePath(): string {
  return join(getLogsDirectory(), 'daemon.log')
}
