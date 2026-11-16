import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  domainLifecycleFixture,
  lifecycleIdentity as identity,
  lifecycleOptions as options
} from './journal-domain-lifecycle.test-fixture'
import { ensureAgentSessionAttachmentClaimTables } from '../agent-session-attachments/agent-session-attachment-claims'
import { agentSessionAttachmentStoreRoot } from '../agent-session-attachments/agent-session-attachment-references'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
})

it('claims the image snapshot a recorded tool call shows, so the sweep keeps it', async () => {
  const f = domainLifecycleFixture(cleanups)
  ensureAgentSessionAttachmentClaimTables(f.db)
  const upload = '0b6f8a52-4a3e-4c4e-9a59-1d5d1f2b8c01'
  const snapshot = join(agentSessionAttachmentStoreRoot(f.directory), upload, 'shot.png')
  mkdirSync(join(agentSessionAttachmentStoreRoot(f.directory), upload), { recursive: true })
  writeFileSync(snapshot, 'bytes')
  await f.run({
    kind: 'item',
    identity: identity('tool-1'),
    body: {
      kind: 'tool-call',
      name: 'Read',
      input: { file_path: '/tmp/shot.png' },
      state: 'completed',
      resultImagePaths: [snapshot]
    },
    options
  })
  expect(
    f.db.prepare(`SELECT upload_id,session_id FROM agent_session_attachment_claims`).all()
  ).toEqual([{ upload_id: upload, session_id: 'chat' }])
})
