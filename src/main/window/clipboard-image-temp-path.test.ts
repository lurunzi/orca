import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Store } from '../persistence'
import { setAppEnvironment, type AppEnvironment } from '../../shared/app-environment'
import { resolveAuthorizedPath } from '../ipc/filesystem-auth'
import {
  createClipboardImageTempFileName,
  isLocalClipboardImageTempFile
} from './clipboard-image-temp-path'

const store = {
  getRepos: () => [],
  getProjectGroups: () => [],
  getFolderWorkspaces: () => [],
  getSettings: () => ({})
} as unknown as Store

let tempDir: string

beforeEach(async () => {
  tempDir = await realpath(await mkdtemp(join(tmpdir(), 'orca-clipboard-temp-')))
  setAppEnvironment({ getPath: () => tempDir } as unknown as AppEnvironment)
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('isLocalClipboardImageTempFile', () => {
  it('recognizes a pasted image Orca named in the app temp dir', () => {
    expect(isLocalClipboardImageTempFile(join(tempDir, createClipboardImageTempFileName()))).toBe(
      true
    )
  })

  it('rejects other names, nested paths, and other directories', () => {
    const name = createClipboardImageTempFileName()
    expect(isLocalClipboardImageTempFile(join(tempDir, 'secret.png'))).toBe(false)
    expect(isLocalClipboardImageTempFile(join(tempDir, 'orca-paste-1-x.png'))).toBe(false)
    expect(isLocalClipboardImageTempFile(join(tempDir, 'nested', name))).toBe(false)
    expect(isLocalClipboardImageTempFile(join(tmpdir(), 'elsewhere', name))).toBe(false)
  })
})

describe('pasted image read authorization after restart', () => {
  it('allows reading a pasted image without the in-memory grant', async () => {
    const imagePath = join(tempDir, createClipboardImageTempFileName())
    await writeFile(imagePath, Buffer.from([1]))

    await expect(resolveAuthorizedPath(imagePath, store)).resolves.toBe(imagePath)
  })

  it.skipIf(process.platform === 'win32')(
    'denies a pasted-image name that symlinks outside the temp dir',
    async () => {
      const secretDir = join(tempDir, 'secret')
      await mkdir(secretDir)
      const secret = join(secretDir, 'id_rsa')
      await writeFile(secret, 'x')
      const imagePath = join(tempDir, createClipboardImageTempFileName())
      await symlink(secret, imagePath)

      await expect(resolveAuthorizedPath(imagePath, store)).rejects.toThrow('Access denied')
    }
  )
})
