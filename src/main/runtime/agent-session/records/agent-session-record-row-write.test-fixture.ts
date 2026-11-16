import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import { encodeAgentSessionRecord } from '../../../../shared/agent-session/lifecycle/records/agent-session-record-stored-form'
import type { AgentSessionRecordStore } from './agent-session-record-store'
import { withTestAgentSessionDatabase } from './agent-session-record-store-persistence.test-fixture'

const RELOAD_NAME = 'orca-test-row-write'

/** Rewrite a record row as another writer would. Only SQLite-side checks see it unless `reloadInto`
 *  routes one real store write through that row so the open store's cache adopts it. */
export async function writeTestAgentSessionRecordRow(
  stateDirectory: string,
  record: AgentSessionRecord,
  reloadInto?: AgentSessionRecordStore
): Promise<void> {
  const row = reloadInto ? { ...record, conversationName: RELOAD_NAME } : record
  await withTestAgentSessionDatabase(stateDirectory, (db) =>
    db
      .prepare('UPDATE agent_session_records SET record_json = ? WHERE session_id = ?')
      .run(JSON.stringify(encodeAgentSessionRecord(row)), record.sessionId)
  )
  await reloadInto?.setConversationName(record.sessionId, record.conversationName ?? null)
}
