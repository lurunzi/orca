import { PRODUCT_IDENTITY } from '../../../shared/product-identity'

export const DEFAULT_MAC_COMMAND_PATH = `/usr/local/bin/${PRODUCT_IDENTITY.cliCommandName}`
export const DEV_COMMAND_NAME = 'orca-dev'
export const LEGACY_LINUX_COMMAND_NAME = 'orca'
export const DEV_LAUNCHER_DIR = ['cli', 'bin'] as const
// UDA Orca: packaged Windows registers a `uda-orca.cmd` forwarder in %LOCALAPPDATA%\UDA Orca\bin
// instead of putting resources\bin (which holds `orca`) on PATH; the NSIS uninstaller removes it.
export const WINDOWS_PACKAGED_COMMAND_DIR = [PRODUCT_IDENTITY.productName, 'bin'] as const
// Cold PowerShell start plus the WM_SETTINGCHANGE broadcast exceeded 5 s on low-spec machines.
export const WINDOWS_PATH_WRITE_TIMEOUT_MS = 15_000
