export const pairedSubscriptionEnabled = (): boolean =>
  process.platform === 'linux' && process.env.ORCA_DASHBOARD_PAIRED_SUBSCRIPTION === '1'

type Lease = { deviceId: string; revoked: boolean; stop: () => void }
const leases = new Map<string, Lease>()
let stopWatching: (() => void) | undefined
let deviceIsCurrent: ((deviceId: string) => boolean) | null = null

export function setSubscriptionDeviceLookup(lookup: (deviceId: string) => boolean): void {
  stopWatching?.()
  stopWatching = undefined
  for (const lease of leases.values()) {
    lease.stop()
  }
  deviceIsCurrent = lookup
}

/** Watch the directory: registry updates use a durable rename and replace the file inode. */
export function watchSubscriptionDevices(
  start: (changed: () => void, failed: () => void) => () => void
): void {
  const failed = (): void => {
    setSubscriptionDeviceLookup(() => false)
  }
  try {
    stopWatching = start(() => {
      for (const lease of leases.values()) {
        if (!isCurrentSubscriptionDevice(lease.deviceId)) {
          lease.stop()
        }
      }
    }, failed)
  } catch {
    failed()
  }
}

export function closeRevokedSubscriptionDevice(deviceId: string): void {
  for (const lease of leases.values()) {
    if (lease.deviceId === deviceId) {
      lease.stop()
    }
  }
}

export function isCurrentSubscriptionDevice(deviceId: string): boolean {
  try {
    return deviceIsCurrent?.(deviceId) === true
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
  if (
    lease &&
    (lease.revoked || deviceId !== lease.deviceId || !isCurrentSubscriptionDevice(lease.deviceId))
  ) {
    lease.stop()
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
