import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRODUCT_IDENTITY, PRODUCT_RELEASE_REPO_SLUG, toOrcaDeepLink } from './product-identity'
import { orcaHomeDir } from './product-identity-home'

const REPO_ROOT = join(import.meta.dirname, '..', '..')
const require = createRequire(import.meta.url)

describe('product identity', () => {
  it('names the UDA Orca fork', () => {
    expect(PRODUCT_IDENTITY).toEqual({
      appId: 'com.ultramarine.uda-orca',
      productName: 'UDA Orca',
      dataDirName: 'uda-orca',
      homeDirName: '.uda-orca',
      cliCommandName: 'uda-orca',
      protocolScheme: 'uda-orca',
      installerFeedUrl: 'https://orca-releases.ultramarinedigitalart.com/channels/stable',
      releaseRepo: { owner: 'Ultramarine-Digital-Art', repo: 'uda-orca-releases' }
    })
    expect(PRODUCT_RELEASE_REPO_SLUG).toBe('Ultramarine-Digital-Art/uda-orca-releases')
  })

  it('keeps the electron-builder config on the same identity', () => {
    const config = require(join(REPO_ROOT, 'config', 'electron-builder.config.cjs'))
    expect(config.appId).toBe(PRODUCT_IDENTITY.appId)
    expect(config.productName).toBe(PRODUCT_IDENTITY.productName)
    expect(config.protocols).toEqual([
      { name: PRODUCT_IDENTITY.productName, schemes: [PRODUCT_IDENTITY.protocolScheme] }
    ])
    expect(config.extraMetadata.name).toBe(PRODUCT_IDENTITY.dataDirName)
    // Executable and installer file names stay upstream's: isolation comes from appId, userData and install dir.
    expect(config.win.executableName).toBe('Orca')
    expect(config.publish).toEqual({
      provider: 'generic',
      url: PRODUCT_IDENTITY.installerFeedUrl
    })
  })

  it('keeps the NSIS hooks on the same names', () => {
    const hooks = readFileSync(
      join(REPO_ROOT, 'config', 'nsis', 'orca-installer-hooks.nsh'),
      'utf8'
    )
    expect(hooks).toContain(`$LOCALAPPDATA\\${PRODUCT_IDENTITY.productName}\\daemon-host-profiles`)
    expect(hooks).toContain(
      `ORCA_REMOVE_USER_PATH_ENTRY "$LOCALAPPDATA\\${PRODUCT_IDENTITY.productName}\\bin"`
    )
    expect(hooks).not.toContain('$LOCALAPPDATA\\Orca\\')
  })

  it('puts user-level state under ~/.uda-orca', () => {
    expect(orcaHomeDir('/home/me')).toBe(join('/home/me', '.uda-orca'))
  })

  it('maps uda-orca:// links onto the orca:// form and leaves others alone', () => {
    expect(toOrcaDeepLink('uda-orca://pair?code=abc')).toBe('orca://pair?code=abc')
    expect(toOrcaDeepLink('  UDA-ORCA://skills/share/x')).toBe('orca://skills/share/x')
    expect(toOrcaDeepLink('orca://plugins/a.b')).toBe('orca://plugins/a.b')
    expect(toOrcaDeepLink('/path/to/uda-orca:file.md')).toBe('/path/to/uda-orca:file.md')
    expect(toOrcaDeepLink('https://share.orca.dev/skills/share/x')).toBe(
      'https://share.orca.dev/skills/share/x'
    )
  })
})
