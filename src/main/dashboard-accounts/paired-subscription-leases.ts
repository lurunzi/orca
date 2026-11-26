export const pairedSubscriptionEnabled = (): boolean =>
  process.platform === 'linux' && process.env.ORCA_DASHBOARD_PAIRED_SUBSCRIPTION === '1'

type Lease = { deviceId: string; revoked: boolean; stop: () => void }
const leases = new Map<string, Lease>()
let stopWatching: (() => void) | undefined
let deviceIsCurrent: ((deviceId: string) => boolean) | null = null
type WatchFailure = 'startup' | 'error' | 'closed' | 'directory replaced'
export type SubscriptionWatchFailure = (reason: WatchFailure, error?: unknown) => void
let watchFailure: string | undefined

function watchErrorCode(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return typeof code === 'string' &&
    ['EACCES', 'ENOENT', 'ENOSPC', 'ENFILE', 'EMFILE', 'EPERM', 'ERR_INVALID_ARG_TYPE'].includes(
      code
    )
    ? code
    : error instanceof TypeError
      ? 'TypeError'
      : ''
}

export function setSubscriptionDeviceLookup(lookup: (deviceId: string) => boolean): void {
  stopWatching?.()
  stopWatching = undefined
  for (const lease of leases.values()) {
    lease.stop()
  }
  deviceIsCurrent = lookup
  watchFailure = undefined
}

/** Watch the directory: registry updates use a durable rename and replace the file inode. */
export function watchSubscriptionDevices(
  start: (changed: () => void, failed: SubscriptionWatchFailure) => () => void
): void {
  const failed: SubscriptionWatchFailure = (reason, error) => {
    setSubscriptionDeviceLookup(() => false)
    watchFailure = [reason, watchErrorCode(error)].filter(Boolean).join(' ')
  }
  try {
    stopWatching = start(() => {
      for (const lease of leases.values()) {
        if (!isCurrentSubscriptionDevice(lease.deviceId)) {
          lease.stop()
        }
      }
    }, failed)
  } catch (error) {
    failed('startup', error)
  }
}

export function closeRevokedSubscriptionDevice(deviceId: string): void {
  for (const lease of leases.values()) {
    if (lease.deviceId === deviceId) {
      lease.stop()
    }
  }
}

export function assertCurrentSubscriptionDevice(deviceId: string): void {
  if (watchFailure) {
    throw new Error(`Paired subscription registry watcher ${watchFailure}`)
  }
  if (!deviceIsCurrent) {
    throw new Error('Paired subscription device registry not initialized')
  }
  let current: boolean
  try {
    current = deviceIsCurrent(deviceId)
  } catch {
    throw new Error('Paired subscription device registry unavailable')
  }
  if (!current) {
    throw new Error('Paired subscription device no longer registered')
  }
}

export function isCurrentSubscriptionDevice(deviceId: string): boolean {
  try {
    assertCurrentSubscriptionDevice(deviceId)
    return true
  } catch {
    return false
  }
}

/** Check at admission as well as actual dispatch. A foreign caller may never borrow a warm writer. */
export function assertSubscriptionSessionDevice(
  sessionId: string,
  deviceId: string | undefined
): void {
  const lease = leases.get(sessionId)
  if (!lease) {
    return
  }
  // A rejected caller cannot change the writer's lifetime. The registry owns revocation.
  if (deviceId === lease.deviceId && !isCurrentSubscriptionDevice(lease.deviceId)) {
    lease.stop()
  }
  if (lease.revoked || deviceId !== lease.deviceId) {
    throw new Error('Paired subscription session access denied')
  }
}

export function retainSubscriptionSession(
  sessionId: string,
  deviceId: string,
  close: () => void
): () => void {
  if (!isCurrentSubscriptionDevice(deviceId) || leases.has(sessionId)) {
    throw new Error('Paired subscription session unavailable')
  }
  const release = (): void => {
    if (leases.get(sessionId) === lease) {
      leases.delete(sessionId)
    }
  }
  const lease: Lease = {
    deviceId,
    revoked: false,
    stop: () => {
      if (lease.revoked) {
        return
      }
      lease.revoked = true
      close()
    }
  }
  leases.set(sessionId, lease)
  return release
}
