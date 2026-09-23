/**
 * Grants a user-opened structured chat its own orchestration identity, so it can coordinate.
 *
 * A dispatched worker's identity is minted before its child spawns; a chat the user already has
 * open was spawned without one. Granting therefore persists a random handle + pane key, registers
 * them, and restarts the idle provider child in place so its environment carries
 * `ORCA_TERMINAL_HANDLE`. Everything downstream — `run-create`, `check`, and the `run:` mailbox
 * nudge — already resolves structured handles through `resolveStructuredWorkerAuthority`.
 *
 * Only the desktop main-process IPC calls this. Exposing it over RPC would let the CLI (and so the
 * agent inside any session) mint identities, which is exactly what `ORCA_STRUCTURED_SESSION`
 * exists to refuse.
 */

import type { StructuredSessionOrchestrationIdentityStatus as Status } from '../../shared/structured-session-orchestration-identity'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import type { OrchestrationDb } from './orchestration/db'
import { readStructuredSessionGateFacts } from './orchestration/structured-mailbox-pointer-host'
import { structuredSessionIdentityRegistryRow } from './structured-worker-authority'
import {
  mintStructuredWorkerHandle,
  mintStructuredWorkerPaneKey,
  structuredWorkerHostScope,
  structuredWorkerIdentities,
  structuredWorkerProcessIncarnation,
  structuredWorkerRecordIsCurrent
} from './structured-worker-identity'

export type StructuredSessionCoordinatorIdentityDeps = {
  getDb: () => OrchestrationDb
  ensureHost: () => Promise<void>
  onSessionActivity: (sessionId: string) => void
  forgetSessionMail: (sessionId: string) => void
}

const RESTART_REASON = 'orchestration identity granted'

/** Sessions holding an active grant; the status feed filter, so it never queries per event. */
const grantedSessionIds = new Set<string>()
const watchedHosts = new WeakSet<StructuredAgentSessionHost>()

type ResolvedSession = { host: StructuredAgentSessionHost; record: AgentSessionRecord }

async function resolveSession(
  deps: StructuredSessionCoordinatorIdentityDeps,
  sessionId: string
): Promise<ResolvedSession | Status> {
  try {
    await deps.ensureHost()
  } catch {
    return { state: 'unavailable', reason: 'missing' }
  }
  const host = getStructuredAgentSessionHost()
  const record = host?.deps.store.getRecord(sessionId) ?? null
  if (!host || !record) {
    return { state: 'unavailable', reason: 'missing' }
  }
  if (!structuredWorkerHostScope(record.location)) {
    return { state: 'unavailable', reason: 'not-local' }
  }
  if (!structuredWorkerRecordIsCurrent(record)) {
    return { state: 'unavailable', reason: 'missing' }
  }
  return { host, record }
}

function openDb(deps: StructuredSessionCoordinatorIdentityDeps): OrchestrationDb | null {
  try {
    return deps.getDb()
  } catch {
    return null
  }
}

function grantStatus(db: OrchestrationDb, sessionId: string): Status {
  if (db.getActiveStructuredSessionIdentityBySessionId(sessionId)) {
    return { state: 'enabled' }
  }
  const registered = structuredWorkerIdentities.getBySessionId(sessionId)
  return registered && registered.origin !== 'session' ? { state: 'worker' } : { state: 'disabled' }
}

export async function readStructuredSessionCoordinatorIdentity(
  deps: StructuredSessionCoordinatorIdentityDeps,
  sessionId: string
): Promise<Status> {
  const resolved = await resolveSession(deps, sessionId)
  if ('state' in resolved) {
    return resolved
  }
  const db = openDb(deps)
  return db
    ? grantStatus(db, sessionId)
    : { state: 'unavailable', reason: 'orchestration-unavailable' }
}

export async function setStructuredSessionCoordinatorIdentity(
  deps: StructuredSessionCoordinatorIdentityDeps,
  sessionId: string,
  enabled: boolean
): Promise<Status> {
  const resolved = await resolveSession(deps, sessionId)
  if ('state' in resolved) {
    // Revoking must still work for a session that has since moved off this host.
    return enabled ? resolved : revoke(deps, sessionId)
  }
  const db = openDb(deps)
  if (!db) {
    return { state: 'unavailable', reason: 'orchestration-unavailable' }
  }
  bindStructuredSessionCoordinatorIdentities({ ...deps, host: resolved.host })
  if (!enabled) {
    return revoke(deps, sessionId)
  }
  const current = grantStatus(db, sessionId)
  if (current.state !== 'disabled') {
    return current
  }
  const { host, record } = resolved
  const attached = host.hasSession(sessionId)
  if (attached) {
    // The restart below would settle a running turn as interrupted.
    const facts = readStructuredSessionGateFacts(sessionId)
    if (!facts || facts.turnRunning || facts.awaitingHuman) {
      return { state: 'unavailable', reason: 'busy' }
    }
  }
  const hostScope = { kind: 'local', hostId: 'local' } as const
  const identity = {
    handle: mintStructuredWorkerHandle(),
    sessionId,
    agent: record.provider,
    paneKey: mintStructuredWorkerPaneKey(sessionId),
    processIncarnation: structuredWorkerProcessIncarnation(sessionId),
    worktreeId: record.location.workspaceId,
    hostScope,
    origin: 'session' as const
  }
  db.insertStructuredSessionIdentity({
    terminal_handle: identity.handle,
    session_id: sessionId,
    pane_key: identity.paneKey,
    worktree_id: identity.worktreeId,
    host_scope: JSON.stringify(hostScope)
  })
  structuredWorkerIdentities.register(identity)
  grantedSessionIds.add(sessionId)
  if (attached) {
    await host.eventRecovery.restartProviderChild(sessionId, RESTART_REASON)
  }
  return { state: 'enabled' }
}

function revoke(deps: StructuredSessionCoordinatorIdentityDeps, sessionId: string): Status {
  const db = openDb(deps)
  const granted = db?.getActiveStructuredSessionIdentityBySessionId(sessionId)
  if (db && granted) {
    db.revokeStructuredSessionIdentity(granted.terminal_handle)
    // The child keeps the dead handle in its env until its next spawn; nothing resolves it now.
    structuredWorkerIdentities.forget(granted.terminal_handle)
    deps.forgetSessionMail(sessionId)
  }
  grantedSessionIds.delete(sessionId)
  return { state: 'disabled' }
}

/**
 * Lets a child spawned after restart find its grant. Install BEFORE the host: host install can
 * resume sessions, and a spawn that misses the loader launches without its identity.
 */
export function installStructuredSessionIdentityLoader(getDb: () => OrchestrationDb): void {
  structuredWorkerIdentities.setSessionIdentityLoader((sessionId) => {
    try {
      const row = getDb().getActiveStructuredSessionIdentityBySessionId(sessionId)
      if (!row) {
        return null
      }
      grantedSessionIds.add(sessionId)
      return structuredSessionIdentityRegistryRow(row)
    } catch {
      return null
    }
  })
}

/**
 * Once per host: redrives parked coordinator mail on status edges. Workers use a per-session
 * journal subscription taken with their hold; a user's chat detaches and re-attaches at will,
 * which drops such a subscription. A grant enters the filter when its child loads it at spawn.
 */
export function bindStructuredSessionCoordinatorIdentities(args: {
  getDb: () => OrchestrationDb
  host: StructuredAgentSessionHost
  onSessionActivity: (sessionId: string) => void
}): void {
  if (watchedHosts.has(args.host)) {
    return
  }
  watchedHosts.add(args.host)
  installStructuredSessionIdentityLoader(args.getDb)
  const onStatus = (sessionId: string) => {
    if (grantedSessionIds.has(sessionId)) {
      args.onSessionActivity(sessionId)
    }
  }
  args.host.subscribeStatus({
    id: 'orchestration:structured-coordinator-redrive',
    emit: (event) => {
      if (event.type === 'status') {
        onStatus(event.session.sessionId)
      } else if (event.type === 'snapshot') {
        for (const session of event.sessions) {
          onStatus(session.sessionId)
        }
      }
    }
  })
}

/** Test-only reset of module state. */
export function resetStructuredSessionCoordinatorIdentitiesForTest(): void {
  grantedSessionIds.clear()
  structuredWorkerIdentities.setSessionIdentityLoader(null)
}
