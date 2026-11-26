/**
 * UDA Orca fork identity: every name that keeps this app apart from the official Orca on one
 * machine lives here, so upstream merges touch call sites only. Renderer-safe (no Node imports);
 * orcaHomeDir() is in product-identity-home.ts. config/electron-builder.config.cjs (CJS, cannot
 * import TS) repeats some literals; product-identity.test.ts
 * keeps them equal.
 */
export const PRODUCT_IDENTITY = {
  appId: 'com.ultramarine.uda-orca',
  /** Shortcuts, uninstall entry, AUMID display name and LOCALAPPDATA root (the Windows executable stays Orca.exe). */
  productName: 'UDA Orca',
  /** userData folder under %APPDATA%, ~/Library/Application Support and $XDG_CONFIG_HOME. */
  dataDirName: 'uda-orca',
  /** User-level state folder in the home directory (the shared ~/.orca/agent-hooks stays put). */
  homeDirName: '.uda-orca',
  /** Command registered on the user's PATH; the bundled resources/bin/orca keeps its name. */
  cliCommandName: 'uda-orca',
  /** URL scheme registered with the OS; links Orca generates keep the orca:// payload format. */
  protocolScheme: 'uda-orca',
  /** electron-updater generic feed (latest.yml, latest-mac.yml) that replaces the GitHub Releases API lookup. */
  installerFeedUrl: 'https://orca-releases.ultramarinedigitalart.com/channels/stable',
  /** GitHub mirror of the installer feed: backup download and release-notes links only. */
  releaseRepo: { owner: 'Ultramarine-Digital-Art', repo: 'uda-orca-releases' }
} as const

/** Null keeps upstream's GitHub Releases lookup; set means the updater reads only this feed. */
export const PRODUCT_INSTALLER_FEED_URL: string | null = PRODUCT_IDENTITY.installerFeedUrl

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
