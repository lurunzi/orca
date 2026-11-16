/**
 * UDA Orca fork identity: every name that keeps this app apart from the official Orca on one
 * machine lives here, so upstream merges touch call sites only. Renderer-safe (no Node imports);
 * orcaHomeDir() is in product-identity-home.ts. config/electron-builder.config.cjs (CJS, cannot
 * import TS) and native/windows-cli-launcher repeat some literals; product-identity.test.ts
 * keeps them equal.
 */
export const PRODUCT_IDENTITY = {
  appId: 'com.ultramarine.uda-orca',
  /** Shortcuts, uninstall entry, AUMID display name, Windows executable and LOCALAPPDATA root. */
  productName: 'UDA Orca',
  /** userData folder under %APPDATA%, ~/Library/Application Support and $XDG_CONFIG_HOME. */
  dataDirName: 'uda-orca',
  /** User-level state folder in the home directory (the shared ~/.orca/agent-hooks stays put). */
  homeDirName: '.uda-orca',
  /** Command registered on the user's PATH; the bundled resources/bin/orca keeps its name. */
  cliCommandName: 'uda-orca',
  /** URL scheme registered with the OS; links Orca generates keep the orca:// payload format. */
  protocolScheme: 'uda-orca',
  releaseRepo: { owner: 'lurunzi', repo: 'orca' }
} as const

/** `owner/repo` of the release feed. */
export const PRODUCT_RELEASE_REPO_SLUG =
  `${PRODUCT_IDENTITY.releaseRepo.owner}/${PRODUCT_IDENTITY.releaseRepo.repo}` as const

/** Rewrites a `uda-orca:` link to the `orca:` form the deep-link parsers accept; other values pass through. */
export function toOrcaDeepLink(value: string): string {
  const trimmed = value.trimStart()
  const prefix = `${PRODUCT_IDENTITY.protocolScheme}:`
  return trimmed.slice(0, prefix.length).toLowerCase() === prefix
    ? `orca:${trimmed.slice(prefix.length)}`
    : value
}
