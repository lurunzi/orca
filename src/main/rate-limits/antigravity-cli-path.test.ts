import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveAntigravityCliPath } from './antigravity-cli-path'

const temporaryRoots: string[] = []
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

describe('resolveAntigravityCliPath', () => {
  it('prefers the executable selected by PATH over a standard install', async () => {
    const resolve = vi.fn().mockResolvedValue('C:/custom/agy.exe')
    expect(await resolveAntigravityCliPath({ LOCALAPPDATA: 'C:/Local' }, 'win32', resolve)).toBe(
      'C:/custom/agy.exe'
    )
    expect(resolve).toHaveBeenCalledExactlyOnceWith('agy', {
      env: { LOCALAPPDATA: 'C:/Local' },
      platform: 'win32'
    })
  })

  it.each(['LOCALAPPDATA', 'LocalAppData'])('finds a Windows install using %s', async (key) => {
    const env = { [key]: 'C:/Users/Example User/AppData/Local', PATH: 'C:/Windows' }
    const candidate = path.win32.join(env[key], 'agy', 'bin', 'agy.exe')
    const resolve = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(candidate)
    expect(await resolveAntigravityCliPath(env, 'win32', resolve)).toBe(candidate)
    expect(resolve).toHaveBeenLastCalledWith(candidate, { env, platform: 'win32' })
  })

  it.each(['darwin', 'linux'] as const)(
    'uses only the execution host HOME on %s',
    async (platform) => {
      const env = { HOME: '/home/remote user', LOCALAPPDATA: 'C:/OtherHost' }
      const resolve = vi.fn().mockResolvedValue(null)
      await resolveAntigravityCliPath(env, platform, resolve)
      expect(resolve).toHaveBeenLastCalledWith('/home/remote user/.local/bin/agy', {
        env,
        platform
      })
      expect(resolve).toHaveBeenCalledTimes(2)
    }
  )

  it.each([{}, { LOCALAPPDATA: 'relative' }, { HOME: '/other-host' }])(
    'does not guess a Windows installation root from %j',
    async (env) => {
      const resolve = vi.fn().mockResolvedValue(null)
      expect(await resolveAntigravityCliPath(env, 'win32', resolve)).toBeNull()
      expect(resolve).toHaveBeenCalledTimes(1)
    }
  )

  it('resolves an actual standard install without PATH and rejects a directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'orca-agy-path-'))
    temporaryRoots.push(root)
    const windows = process.platform === 'win32'
    const bin = path.join(root, windows ? 'agy' : '.local', 'bin')
    const candidate = path.join(bin, windows ? 'agy.exe' : 'agy')
    const env = windows ? { LOCALAPPDATA: root, PATH: '' } : { HOME: root, PATH: '' }
    await mkdir(candidate, { recursive: true })
    expect(await resolveAntigravityCliPath(env, process.platform)).toBeNull()
    await rm(candidate, { recursive: true })
    await writeFile(candidate, '#!/bin/sh\n')
    await chmod(candidate, 0o755)
    const resolved = await resolveAntigravityCliPath(env, process.platform)
    expect(resolved && path.normalize(resolved)).toBe(candidate)
  })
})
