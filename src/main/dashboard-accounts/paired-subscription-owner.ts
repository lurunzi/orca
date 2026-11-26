import { getActiveRpcCaller } from '../runtime/rpc/callers/active-call'
import type { RpcCallerIdentity } from '../runtime/rpc/callers/rpc-caller-identity'
import {
  assertSubscriptionSessionDevice,
  assertCurrentSubscriptionDevice
} from './paired-subscription-leases'

export function subscriptionDevice(caller = getActiveRpcCaller()): string {
  if (!caller) {
    throw new Error('Paired subscription RPC caller missing')
  }
  if (caller.kind !== 'paired-device') {
    throw new Error('Paired subscription RPC caller is not a paired device')
  }
  assertCurrentSubscriptionDevice(caller.deviceId)
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
