import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../sqlite/sync-database'
import { rootMessageIds } from './cursor-acp-session-store'
import { validateAiVaultSessionDeleteTarget } from './session-delete-target'
import { scanAiVaultSessions } from './session-scanner'
import { assertLegacyAiVaultResumeAllowed } from './structured-session-ownership'
import { isolatedScanRoots } from './session-scanner-test-fixtures'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

function blobId(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

// Root node: field 1 lists message ids; trailing fields mimic the store's other tree data.
function rootBlob(ids: readonly string[]): Buffer {
  const parts = ids.map((id) => Buffer.concat([Buffer.from([0x0a, 0x20]), Buffer.from(id, 'hex')]))
  return Buffer.concat([...parts, Buffer.from([0x28, 0x05, 0x42, 0x02, 0x68, 0x69])])
}

function writeAcpStore(dbPath: string, messages: readonly Record<string, unknown>[]): void {
  const db = new SyncDatabase(dbPath)
  try {
    db.exec('CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)')
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)')
    const insert = db.prepare('INSERT INTO blobs (id, data) VALUES (?, ?)')
    const ids = messages.map((message) => {
      const data = Buffer.from(JSON.stringify(message))
      const id = blobId(data)
      insert.run(id, data)
      return id
    })
    // An unreferenced blob from an abandoned branch must not count.
    const orphan = Buffer.from(JSON.stringify({ role: 'user', content: 'abandoned branch' }))
    insert.run(blobId(orphan), orphan)
    const root = rootBlob(ids)
    insert.run(blobId(root), root)
    const meta = JSON.stringify({
      agentId: 'acp-session',
      latestRootBlobId: blobId(root),
      name: 'Store Name',
      createdAt: Date.parse('2026-11-07T17:57:03Z')
    })
    db.prepare("INSERT INTO meta (key, value) VALUES ('0', ?)").run(
      Buffer.from(meta).toString('hex')
    )
  } finally {
    db.close()
  }
}

const CONVERSATION = [
  { role: 'system', content: 'You are an AI coding assistant.' },
  { role: 'user', content: '<user_info>\nOS Version: win32\n</user_info>' },
  {
    role: 'user',
    content:
      '<timestamp>Saturday, Nov 7, 2026, 5:56 PM (UTC)</timestamp>\n<system_notification>\nA task finished.\n</system_notification>'
  },
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: '<timestamp>Saturday, Nov 7, 2026, 5:57 PM (UTC)</timestamp>\n<user_query>\nReview performance\n</user_query>'
      }
    ]
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'reasoning',
        text: 'Looking around',
        providerOptions: { cursor: { modelName: 'm-1' } }
      },
      { type: 'tool-call', toolCallId: 't1', toolName: 'Read', input: {} }
    ]
  },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: 't1', output: 'file' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Found two hot loops.' }] }
]

async function acpHome(): Promise<{ home: string; sessions: string }> {
  const home = await mkdtemp(join(tmpdir(), 'orca-cursor-acp-'))
  temporaryDirectories.push(home)
  return { home, sessions: join(home, 'acp-sessions') }
}

describe('Cursor ACP session history', () => {
  it('lists acp-sessions chats with their title, workspace and ordered turns', async () => {
    const { home, sessions } = await acpHome()
    const dir = join(sessions, 'acp-session')
    await mkdir(dir, { recursive: true })
    const workspace = join(home, 'project')
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({ schemaVersion: 1, cwd: workspace, title: 'Critical Performance Review' })
    )
    writeAcpStore(join(dir, 'store.db'), CONVERSATION)
    // Not a session directory layout: a stray meta.json at the root.
    await writeFile(join(sessions, 'meta.json'), JSON.stringify({ cwd: workspace }))

    const result = await scanAiVaultSessions({
      ...isolatedScanRoots(home),
      cursorAcpSessionsDir: sessions
    })

    expect(result.issues).toEqual([])
    expect(result.sessions).toHaveLength(1)
    const [session] = result.sessions
    expect(session).toMatchObject({
      agent: 'cursor',
      sessionId: 'acp-session',
      title: 'Critical Performance Review',
      cwd: workspace,
      model: 'm-1',
      messageCount: 2,
      createdAt: '2026-11-07T17:57:03.000Z'
    })
    expect(session!.previewMessages.map((message) => message.text)).toEqual([
      'Review performance',
      'Found two hot loops.'
    ])

    const scoped = await scanAiVaultSessions({
      ...isolatedScanRoots(home),
      cursorAcpSessionsDir: sessions,
      scopePaths: [workspace]
    })
    expect(scoped.sessions.map((row) => row.sessionId)).toContain('acp-session')
  })

  it('falls back to the store name and lists a chat whose store was never written', async () => {
    const { home, sessions } = await acpHome()
    const named = join(sessions, 'named')
    const fresh = join(sessions, 'fresh')
    await mkdir(named, { recursive: true })
    await mkdir(fresh, { recursive: true })
    await writeFile(join(named, 'meta.json'), JSON.stringify({ cwd: home }))
    writeAcpStore(join(named, 'store.db'), CONVERSATION)
    await writeFile(join(fresh, 'meta.json'), JSON.stringify({ cwd: home }))

    const result = await scanAiVaultSessions({
      ...isolatedScanRoots(home),
      cursorAcpSessionsDir: sessions
    })

    const byId = new Map(result.sessions.map((session) => [session.sessionId, session]))
    expect(byId.get('named')?.title).toBe('Store Name')
    expect(byId.get('fresh')).toMatchObject({ cwd: home, messageCount: 0 })
  })

  it('deletes the whole ACP session directory', async () => {
    const { home, sessions } = await acpHome()
    const metaPath = join(sessions, 'acp-session', 'meta.json')
    const target = validateAiVaultSessionDeleteTarget({
      agent: 'cursor',
      filePath: metaPath,
      executionHostId: 'local',
      rootOptions: { ...isolatedScanRoots(home), cursorAcpSessionsDir: sessions }
    })
    expect(target).toMatchObject({
      allowed: true,
      removals: [{ path: join(sessions, 'acp-session'), kind: 'directory' }]
    })
  })

  it('reads ordered field-1 ids and stops at a truncated field', () => {
    const id = 'ab'.repeat(32)
    const root = rootBlob([id, id])
    expect(rootMessageIds(root)).toEqual([id, id])
    expect(rootMessageIds(Buffer.concat([root, Buffer.from([0x0a, 0x20, 0x01])]))).toEqual([id, id])
  })

  it('refuses a terminal resume, which would start an empty chat under the same id', () => {
    const resume = (filePath: string) => () =>
      assertLegacyAiVaultResumeAllowed({
        agent: 'cursor',
        sessionId: 'acp-session',
        filePath,
        codexHome: null,
        executionHostId: 'local',
        fork: true
      })
    expect(resume(join(tmpdir(), 'acp-sessions', 'acp-session', 'meta.json'))).toThrow(
      'cannot be resumed in a terminal'
    )
    expect(
      resume(join(tmpdir(), 'projects', 'p', 'agent-transcripts', 'id', 'id.jsonl'))
    ).not.toThrow()
  })
})

describe('Cursor transcript discovery', () => {
  it('lists a parent transcript but not its Task subagent transcripts', async () => {
    const { home } = await acpHome()
    const projects = join(home, 'cursor-projects')
    const parentDir = join(projects, 'project', 'agent-transcripts', 'parent')
    await mkdir(join(parentDir, 'subagents'), { recursive: true })
    const line = JSON.stringify({ role: 'user', message: { content: 'hello' } })
    await writeFile(join(parentDir, 'parent.jsonl'), `${line}\n`)
    await writeFile(join(parentDir, 'subagents', 'child.jsonl'), `${line}\n`)

    const result = await scanAiVaultSessions({
      ...isolatedScanRoots(home),
      cursorProjectsDir: projects
    })

    expect(result.sessions.map((session) => session.sessionId)).toEqual(['parent'])
  })
})
