import type { StructuredSessionIdentityRow } from './orchestration/db/structured-session-identity/structured-session-identity-store'
import {
  structuredWorkerProcessIncarnation,
  type StructuredWorkerIdentityRow
} from './structured-worker-identity'

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
