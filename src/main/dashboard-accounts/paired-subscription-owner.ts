import { getActiveRpcCaller } from '../runtime/rpc/callers/active-call'
import type { RpcCallerIdentity } from '../runtime/rpc/callers/rpc-caller-identity'
import {
  assertSubscriptionSessionDevice,
  isCurrentSubscriptionDevice
} from './paired-subscription-leases'

export function subscriptionDevice(caller = getActiveRpcCaller()): string {
  if (caller?.kind !== 'paired-device' || !isCurrentSubscriptionDevice(caller.deviceId)) {
    throw new Error('Paired subscription device authorization required')
  }
  return caller.deviceId
}
export function assertSubscriptionSessionCaller(
  sessionId: string,
  caller: RpcCallerIdentity | undefined
): void {
  assertSubscriptionSessionDevice(
    sessionId,
    caller?.kind === 'paired-device' ? caller.deviceId : undefined
  )
}
