import { getActiveRpcCaller } from '../runtime/rpc/callers/active-call'
import type { RpcCallerIdentity } from '../runtime/rpc/callers/rpc-caller-identity'

export const pairedSubscriptionEnabled = (): boolean =>
  process.platform === 'linux' && process.env.ORCA_DASHBOARD_PAIRED_SUBSCRIPTION === '1'

type Lease = { deviceId: string; revoked: boolean; stop: () => void }
const leases = new Map<string, Lease>()
let deviceIsCurrent: ((deviceId: string) => boolean) | null = null

export function setSubscriptionDeviceLookup(lookup: (deviceId: string) => boolean): void {
  for (const lease of leases.values()) {
    lease.stop()
  }
  deviceIsCurrent = lookup
}

export function closeRevokedSubscriptionDevice(deviceId: string): void {
  for (const lease of leases.values()) {
    if (lease.deviceId === deviceId) {
      lease.stop()
    }
  }
}

function isCurrent(deviceId: string): boolean {
  try {
    return deviceIsCurrent?.(deviceId) === true
  } catch {
    return false
  }
}

export function subscriptionDevice(caller = getActiveRpcCaller()): string {
  if (caller?.kind !== 'paired-device' || !isCurrent(caller.deviceId)) {
    throw new Error('Paired subscription device authorization required')
  }
  return caller.deviceId
}

/** Check at admission as well as actual dispatch. A foreign caller may never borrow a warm writer. */
export function assertSubscriptionSessionCaller(
  sessionId: string,
  caller: RpcCallerIdentity | undefined
): void {
  const lease = leases.get(sessionId)
  if (
    lease &&
    (lease.revoked ||
      caller?.kind !== 'paired-device' ||
      caller.deviceId !== lease.deviceId ||
      !isCurrent(lease.deviceId))
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
  if (!isCurrent(deviceId) || leases.has(sessionId)) {
    throw new Error('Paired subscription session unavailable')
  }
  const release = (): void => {
    if (leases.get(sessionId) === lease) {
      leases.delete(sessionId)
    }
    clearInterval(timer)
  }
  const lease: Lease = {
    deviceId,
    revoked: false,
    stop: () => {
      if (lease.revoked) {
        return
      }
      lease.revoked = true
      clearInterval(timer)
      close()
    }
  }
  const timer = setInterval(() => {
    if (!isCurrent(deviceId)) {
      lease.stop()
    }
  }, 1000)
  timer.unref()
  leases.set(sessionId, lease)
  return release
}
