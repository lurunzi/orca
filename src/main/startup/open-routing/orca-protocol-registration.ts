import type { App } from 'electron'
import { PRODUCT_IDENTITY } from '../../../shared/product-identity'

/**
 * Registers `uda-orca://` with Windows, which NSIS installs leave unregistered; macOS reads it from
 * Info.plist and Linux packages from the desktop entry. Only packaged desktop launches register,
 * so dev, test and serve runs never take over the machine's handler. UDA Orca leaves `orca://` to
 * the official Orca.
 */
export function registerOrcaProtocolClient(
  app: Pick<App, 'isPackaged' | 'isDefaultProtocolClient' | 'setAsDefaultProtocolClient'>,
  options: { platform: NodeJS.Platform; desktopLaunch: boolean }
): boolean {
  const scheme = PRODUCT_IDENTITY.protocolScheme
  if (options.platform !== 'win32' || !app.isPackaged || !options.desktopLaunch) {
    return false
  }
  if (app.isDefaultProtocolClient(scheme)) {
    return false
  }
  try {
    return app.setAsDefaultProtocolClient(scheme)
  } catch (error) {
    console.warn(`[protocol] Failed to register ${scheme}:// links:`, error)
    return false
  }
}
