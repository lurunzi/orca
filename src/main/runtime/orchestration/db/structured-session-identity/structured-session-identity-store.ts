/**
 * Durable orchestration identities granted to user-opened structured chat sessions.
 *
 * A dispatched structured worker persists its identity in `worker_terminal_resources`, which is
 * keyed by a dispatch. A session the user promoted to coordinator has no dispatch, so its handle
 * and random pane key live here instead — the pane key is a credential, which is why this is not
 * kept in the renderer-readable agent-session record file.
 *
 * Created by `createTables` (every open, IF NOT EXISTS) rather than a numbered migration, so a fork
 * build never claims a schema version upstream may later assign to something else.
 */

import type { OrchestrationDb } from '../orchestration-db'

export const STRUCTURED_SESSION_IDENTITIES_SQL = `
CREATE TABLE IF NOT EXISTS structured_session_identities (
  terminal_handle TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  pane_key        TEXT NOT NULL,
  worktree_id     TEXT NOT NULL,
  host_scope      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_structured_session_identities_active
  ON structured_session_identities(session_id) WHERE revoked_at IS NULL;
`

export type StructuredSessionIdentityRow = {
  terminal_handle: string
  session_id: string
  pane_key: string
  worktree_id: string
  host_scope: string
  created_at: string
  revoked_at: string | null
}

function readText(value: object, key: string): string | null {
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'string' ? field : null
}

/** Checked read: a row is a credential, so a malformed one is absent rather than trusted. */
function readIdentityRow(value: unknown): StructuredSessionIdentityRow | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const [terminalHandle, sessionId, paneKey, worktreeId, hostScope, createdAt] = [
    'terminal_handle',
    'session_id',
    'pane_key',
    'worktree_id',
    'host_scope',
    'created_at'
  ].map((key) => readText(value, key))
  if (!terminalHandle || !sessionId || !paneKey || !worktreeId || !hostScope || !createdAt) {
    return undefined
  }
  return {
    terminal_handle: terminalHandle,
    session_id: sessionId,
    pane_key: paneKey,
    worktree_id: worktreeId,
    host_scope: hostScope,
    created_at: createdAt,
    revoked_at: readText(value, 'revoked_at')
  }
}

export function insertStructuredSessionIdentity(
  this: OrchestrationDb,
  row: Pick<
    StructuredSessionIdentityRow,
    'terminal_handle' | 'session_id' | 'pane_key' | 'worktree_id' | 'host_scope'
  >
): void {
  this.db
    .prepare(
      `INSERT INTO structured_session_identities
         (terminal_handle, session_id, pane_key, worktree_id, host_scope)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(row.terminal_handle, row.session_id, row.pane_key, row.worktree_id, row.host_scope)
}

export function getActiveStructuredSessionIdentityByHandle(
  this: OrchestrationDb,
  terminalHandle: string
): StructuredSessionIdentityRow | undefined {
  return readIdentityRow(
    this.db
      .prepare(
        `SELECT * FROM structured_session_identities
          WHERE terminal_handle = ? AND revoked_at IS NULL`
      )
      .get(terminalHandle)
  )
}

export function getActiveStructuredSessionIdentityBySessionId(
  this: OrchestrationDb,
  sessionId: string
): StructuredSessionIdentityRow | undefined {
  return readIdentityRow(
    this.db
      .prepare(
        `SELECT * FROM structured_session_identities
          WHERE session_id = ? AND revoked_at IS NULL`
      )
      .get(sessionId)
  )
}

export function listActiveStructuredSessionIdentities(
  this: OrchestrationDb
): StructuredSessionIdentityRow[] {
  return this.db
    .prepare('SELECT * FROM structured_session_identities WHERE revoked_at IS NULL')
    .all()
    .map(readIdentityRow)
    .filter((row) => row !== undefined)
}

/** Revoked rows are kept so an audit can still name the handle a Run was once bound to. */
export function revokeStructuredSessionIdentity(
  this: OrchestrationDb,
  terminalHandle: string
): boolean {
  return (
    this.db
      .prepare(
        `UPDATE structured_session_identities SET revoked_at = datetime('now')
          WHERE terminal_handle = ? AND revoked_at IS NULL`
      )
      .run(terminalHandle).changes > 0
  )
}

export type StructuredSessionIdentityStoreMethods = {
  insertStructuredSessionIdentity: typeof insertStructuredSessionIdentity
  getActiveStructuredSessionIdentityByHandle: typeof getActiveStructuredSessionIdentityByHandle
  getActiveStructuredSessionIdentityBySessionId: typeof getActiveStructuredSessionIdentityBySessionId
  listActiveStructuredSessionIdentities: typeof listActiveStructuredSessionIdentities
  revokeStructuredSessionIdentity: typeof revokeStructuredSessionIdentity
}

export function attachStructuredSessionIdentityStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    insertStructuredSessionIdentity,
    getActiveStructuredSessionIdentityByHandle,
    getActiveStructuredSessionIdentityBySessionId,
    listActiveStructuredSessionIdentities,
    revokeStructuredSessionIdentity
  })
}
