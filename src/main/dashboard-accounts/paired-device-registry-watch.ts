import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { DEVICE_REGISTRY_FILENAME } from '../runtime/rpc/server/pairing/mobile-pairing-files'
import type { SubscriptionWatchFailure } from './paired-subscription-leases'

/** Subscribe between two directory identity reads. Ignore notices left behind by an old observer. */
export function observeSubscriptionRegistry(
  dir: string,
  changed: () => void,
  failed: SubscriptionWatchFailure,
  ready: () => void
): () => void {
  let active = true
  let watcher: FSWatcher | undefined
  const fail: SubscriptionWatchFailure = (reason, error) => {
    if (active) {
      failed(reason, error)
    }
  }
  async function arm(): Promise<void> {
    const initial = await stat(dir, { bigint: true })
    if (!active) {
      return
    }
    const sameDirectory = async (): Promise<boolean> => {
      try {
        const current = await stat(dir, { bigint: true })
        if (initial.dev === current.dev && initial.ino === current.ino) {
          return true
        }
        fail('directory replaced')
      } catch (error) {
        fail('directory replaced', error)
      }
      return false
    }
    watcher = watch(dir, { persistent: false }, (event, name) => {
      if (!active) {
        return
      }
      if (event === 'rename' && name === basename(dir)) {
        void sameDirectory()
      }
      if (name === null || name === DEVICE_REGISTRY_FILENAME) {
        changed()
      }
    })
    watcher.once('error', (error) => fail('error', error))
    watcher.once('close', () => fail('closed'))
    if ((await sameDirectory()) && active) {
      ready()
    }
  }
  void arm().catch((error: unknown) => fail('startup', error))
  return () => {
    active = false
    watcher?.close()
  }
}
