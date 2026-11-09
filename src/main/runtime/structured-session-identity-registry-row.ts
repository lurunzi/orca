import type { OrchestrationDb } from './orchestration/db/orchestration-db'
import type { StructuredSessionIdentityRow } from './orchestration/db/structured-session-identity/structured-session-identity-store'
import {
  structuredWorkerIdentities,
  structuredWorkerProcessIncarnation,
  type StructuredWorkerIdentity,
  type StructuredWorkerIdentityRow
} from './orchestration/terminal-authority/structured-sessions/structured-worker-identity'

/** A session grant has no process row of its own; its lineage is the session, as for a worker. */
export function structuredSessionIdentityRegistryRow(
  row: Pick<
    StructuredSessionIdentityRow,
    'terminal_handle' | 'session_id' | 'pane_key' | 'worktree_id' | 'host_scope'
  >
): StructuredWorkerIdentityRow {
  return {
    terminal_handle: row.terminal_handle,
    pane_key: row.pane_key,
    process_incarnation: structuredWorkerProcessIncarnation(row.session_id),
    worktree_id: row.worktree_id,
    host_scope: row.host_scope
  }
}

/** A handle no worker process row names may still be an active session grant's worker. */
export function rehydrateStructuredSessionGrantIdentity(
  handle: string,
  db: OrchestrationDb | null | undefined
): StructuredWorkerIdentity | null {
  const granted = db?.getActiveStructuredSessionIdentityByHandle?.(handle)
  return granted
    ? structuredWorkerIdentities.rehydrate(structuredSessionIdentityRegistryRow(granted), 'session')
    : null
}
