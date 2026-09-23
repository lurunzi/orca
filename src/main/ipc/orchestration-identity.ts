import { ipcMain } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  readStructuredSessionCoordinatorIdentity,
  setStructuredSessionCoordinatorIdentity,
  type StructuredSessionCoordinatorIdentityDeps
} from '../runtime/structured-session-coordinator-identity'
import {
  ORCHESTRATION_IDENTITY_GET_CHANNEL,
  ORCHESTRATION_IDENTITY_SET_CHANNEL,
  type StructuredSessionOrchestrationIdentityStatus
} from '../../shared/structured-session-orchestration-identity'

function readSessionId(args: unknown): string | null {
  if (!args || typeof args !== 'object' || !('sessionId' in args)) {
    return null
  }
  return typeof args.sessionId === 'string' && args.sessionId.length > 0 ? args.sessionId : null
}

const MISSING: StructuredSessionOrchestrationIdentityStatus = {
  state: 'unavailable',
  reason: 'missing'
}

/** Main-process IPC only: the grant is a bearer credential, so no RPC or CLI path may mint one. */
export function registerOrchestrationIdentityHandlers(runtime: OrcaRuntimeService): void {
  const deps: StructuredSessionCoordinatorIdentityDeps = {
    getDb: () => runtime.getOrchestrationDb(),
    ensureHost: () => runtime.ensureStructuredAgentSessionHost(),
    onSessionActivity: (sessionId) => runtime.notifyStructuredSessionJournalActivity(sessionId),
    forgetSessionMail: (sessionId) => runtime.forgetStructuredSessionMail(sessionId)
  }
  ipcMain.handle(ORCHESTRATION_IDENTITY_GET_CHANNEL, (_event, args: unknown) => {
    const sessionId = readSessionId(args)
    return sessionId ? readStructuredSessionCoordinatorIdentity(deps, sessionId) : MISSING
  })
  ipcMain.handle(ORCHESTRATION_IDENTITY_SET_CHANNEL, (_event, args: unknown) => {
    const sessionId = readSessionId(args)
    const enabled =
      args && typeof args === 'object' && 'enabled' in args && typeof args.enabled === 'boolean'
        ? args.enabled
        : null
    return sessionId && enabled !== null
      ? setStructuredSessionCoordinatorIdentity(deps, sessionId, enabled)
      : MISSING
  })
}
