import type Database from '../../sqlite/sync-database'
import { claimAgentSessionAttachmentsInTransaction } from '../agent-session-attachments/agent-session-attachment-claims'
import type { JournalWriterCommand } from './journal-writer-command'
import type { JournalWriterPublication } from './journal-writer-changes'
import type { JournalGoalAttachmentInverse } from './writing/journal-goal-attachment-inverse'

/** Stored snapshots of what a tool showed the agent live as long as the chat does. */
export function claimJournalSqlToolImageSnapshots(
  db: Database.Database,
  stateDirectory: string,
  command: JournalWriterCommand,
  publication: JournalWriterPublication,
  goals: JournalGoalAttachmentInverse
): string[] {
  const referenced: string[] = []
  for (const item of publication.items) {
    const paths = item.body.kind === 'tool-call' ? (item.body.resultImagePaths ?? []) : []
    if (paths.length === 0) {
      continue
    }
    const claim = claimAgentSessionAttachmentsInTransaction(db, {
      stateDirectory,
      sessionId: command.target.sessionId,
      body: {
        kind: 'message',
        role: 'tool',
        blocks: paths.map((path) => ({ type: 'image-ref' as const, path }))
      },
      required: false,
      now: command.savedAt ?? Date.now()
    })
    goals.acquired(claim.referenced, claim.inserted)
    referenced.push(...claim.referenced)
  }
  return referenced
}
