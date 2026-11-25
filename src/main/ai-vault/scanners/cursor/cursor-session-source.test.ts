import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanAiVaultSessions } from '../../session-scanner'
import { isolatedScanRoots } from '../../scanner-fixtures/session-scanner-test-fixtures'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

describe('Cursor transcript discovery', () => {
  it('lists a parent transcript but not its Task subagent transcripts', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orca-cursor-source-'))
    temporaryDirectories.push(home)
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
