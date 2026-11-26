import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { DEVICE_REGISTRY_FILENAME } from '../runtime/rpc/server/pairing/mobile-pairing-files'
import { observeSubscriptionRegistry } from './paired-device-registry-watch'

it('accepts an atomic registry replacement and ignores a child with the profile basename', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-subscription-watch-'))
  const dir = join(root, 'profile')
  const changed = Promise.withResolvers<void>()
  const ready = Promise.withResolvers<void>()
  const failed = vi.fn()
  let stop = (): void => {}
  try {
    await mkdir(dir)
    stop = observeSubscriptionRegistry(dir, changed.resolve, failed, ready.resolve)
    await ready.promise
    // Linux may report the same basename both for an entry here and for the watched directory.
    await writeFile(join(dir, 'profile'), '')
    await writeFile(join(dir, 'pending'), '[]')
    await rename(join(dir, 'pending'), join(dir, DEVICE_REGISTRY_FILENAME))
    await changed.promise
    expect(failed).not.toHaveBeenCalled()
    stop()
    await rm(dir, { recursive: true })
    expect(failed).not.toHaveBeenCalled()
  } finally {
    stop()
    await rm(root, { recursive: true, force: true })
  }
})

it('refuses a missing registry directory at startup without becoming ready', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-subscription-watch-'))
  const ready = vi.fn()
  const failure = Promise.withResolvers<string>()
  const stop = observeSubscriptionRegistry(
    join(root, 'missing'),
    () => {},
    (stage) => failure.resolve(stage),
    ready
  )
  try {
    expect(await failure.promise).toBe('startup')
    expect(ready).not.toHaveBeenCalled()
  } finally {
    stop()
    await rm(root, { recursive: true, force: true })
  }
})
