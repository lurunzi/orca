import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ReleaseCheckError, verifyReleaseDir } from './release-feed.mjs'

const INSTALLER_SHA512 =
  'MH/z2LtTngjQUiyWAmnwxFM7zzkLvO6hMoinhLG4Sx2DfQ0ZHqDtAgrObmxXmW0FmWHmfwuVx7JWjbNUBZc8LA=='

let dir
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function fixture({ sha512 = INSTALLER_SHA512, size = 15, version = '1.4.27501' } = {}) {
  dir = mkdtempSync(path.join(tmpdir(), 'uda-release-feed-'))
  writeFileSync(path.join(dir, 'Orca-Setup-1.4.27501.exe'), 'installer-bytes')
  writeFileSync(path.join(dir, 'Orca-Setup-1.4.27501.exe.blockmap'), 'blockmap-bytes')
  writeFileSync(
    path.join(dir, 'latest.yml'),
    [
      `version: ${version}`,
      'files:',
      '  - url: Orca-Setup-1.4.27501.exe',
      `    sha512: ${sha512}`,
      `    size: ${size}`,
      'path: Orca-Setup-1.4.27501.exe',
      `sha512: ${sha512}`,
      "releaseDate: '2026-11-26T00:00:00.000Z'",
      ''
    ].join('\n')
  )
  return dir
}

describe('verifyReleaseDir', () => {
  it('uploads only the feed, referenced files, their blockmaps and SHA256SUMS', async () => {
    fixture()
    writeFileSync(path.join(dir, 'SHA256SUMS'), 'sums')
    writeFileSync(path.join(dir, 'builder-debug.yml'), 'x')
    writeFileSync(path.join(dir, 'Orca-Setup-0.9.0.exe'), 'old')
    writeFileSync(path.join(dir, 'Orca-Setup-1.4.27501.exe.blockmap~'), 'x')
    writeFileSync(path.join(dir, '.hidden.blockmap'), 'x')
    mkdirSync(path.join(dir, 'win-unpacked'))

    const result = await verifyReleaseDir({ dir, version: '1.4.27501' })

    expect(result.feed).toBe('latest.yml')
    expect(result.platform).toBe('win')
    expect(result.upload).toEqual([
      'latest.yml',
      'Orca-Setup-1.4.27501.exe',
      'Orca-Setup-1.4.27501.exe.blockmap',
      'SHA256SUMS'
    ])
    expect(result.leftOut.map((entry) => entry.name).sort()).toEqual([
      '.hidden.blockmap',
      'Orca-Setup-0.9.0.exe',
      'Orca-Setup-1.4.27501.exe.blockmap~',
      'builder-debug.yml',
      'win-unpacked'
    ])
  })

  it('refuses a feed whose sha512 does not match the file', async () => {
    fixture({
      sha512:
        'xTUBlBlAJ4M5brEjgYtqce78AStitGoHdTmYhZJJ4V/d/9p+PEil4tLbs6yv72De8bnoh1lwhLifiN4/oJLTcQ=='
    })
    await expect(verifyReleaseDir({ dir, version: '1.4.27501' })).rejects.toThrow(
      'latest.yml: sha512 mismatch for Orca-Setup-1.4.27501.exe'
    )
  })

  it('refuses a size mismatch and a version mismatch', async () => {
    fixture({ size: 16 })
    await expect(verifyReleaseDir({ dir, version: '1.4.27501' })).rejects.toThrow(
      'size mismatch for Orca-Setup-1.4.27501.exe'
    )
    rmSync(dir, { recursive: true, force: true })
    fixture()
    await expect(verifyReleaseDir({ dir, version: '1.4.27502' })).rejects.toThrow(
      'latest.yml: version is 1.4.27501, expected 1.4.27502'
    )
  })

  it('refuses a feed entry the server would not accept', async () => {
    fixture()
    writeFileSync(
      path.join(dir, 'latest.yml'),
      `version: 1.4.27501\nfiles:\n  - url: ../Orca-Setup-1.4.27501.exe\n    sha512: ${INSTALLER_SHA512}\n`
    )
    await expect(verifyReleaseDir({ dir, version: '1.4.27501' })).rejects.toBeInstanceOf(
      ReleaseCheckError
    )
  })

  it('requires --platform when both feeds are present', async () => {
    fixture()
    writeFileSync(path.join(dir, 'latest-mac.yml'), 'version: 1.4.27501\n')
    await expect(verifyReleaseDir({ dir, version: '1.4.27501' })).rejects.toThrow('--platform')
    const result = await verifyReleaseDir({ dir, version: '1.4.27501', platform: 'win' })
    expect(result.upload).not.toContain('latest-mac.yml')
  })
})
