import type {
  RuntimeRpcResponse,
  RuntimeRpcSuccess
} from '../../../../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import type { RuntimeStatus } from '../../../../../shared/remote-runtime/session-graph/runtime-session-contracts'
import {
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  RUNTIME_PROTOCOL_VERSION
} from '../../../../../shared/remote-runtime/protocol/protocol-version'
import { ADVERTISED_RUNTIME_CAPABILITIES } from '../../../../../shared/agent-provider-runtime-capabilities'

export type RuntimeEnvironmentCallRequest = {
  method: string
  params?: Record<string, unknown>
}

export function createCompatibleRuntimeStatusResponse(
  runtimeId = 'remote-runtime'
): RuntimeRpcSuccess<RuntimeStatus> {
  return {
    id: 'status',
    ok: true,
    result: {
      runtimeId,
      rendererGraphEpoch: 0,
      graphStatus: 'ready',
      authoritativeWindowId: null,
      liveTabCount: 0,
      liveLeafCount: 0,
      runtimeProtocolVersion: RUNTIME_PROTOCOL_VERSION,
      minCompatibleRuntimeClientVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
      capabilities: [...ADVERTISED_RUNTIME_CAPABILITIES]
    },
    _meta: { runtimeId }
  }
}

export function createCompatibleRuntimeStatusResponseIfNeeded(
  args: RuntimeEnvironmentCallRequest,
  runtimeId?: string
): RuntimeRpcResponse<RuntimeStatus> | null {
  return args.method === 'status.get' ? createCompatibleRuntimeStatusResponse(runtimeId) : null
}
