import { copyFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { removeTree } from '../../../shared/windows-transient-lock-removal'
import { prepareLegacyTranscriptImport } from './journal-legacy-import'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root)))
})

it.each(['cursor', 'antigravity'] as const)(
  'imports %s transcript messages into journal items',
  async (agent) => {
    const root = await mkdtemp(join(tmpdir(), 'orca-provider-journal-'))
    roots.push(root)
    const filePath = join(root, 'transcript.jsonl')
    const cursorRecords = [
      { role: 'user', message: { content: [{ type: 'text', text: 'Inspect the sample file.' }] } },
      {
        role: 'assistant',
        message: { content: [{ type: 'text', text: 'The file contains sample.' }] }
      },
      { type: 'turn_ended', status: 'success' }
    ]
      .map((record) => JSON.stringify(record))
      .join('\n')
    await (agent === 'antigravity'
      ? copyFile(new URL('../__fixtures__/antigravity/tool-turn.jsonl', import.meta.url), filePath)
      : writeFile(filePath, `${cursorRecords}\n`))
    const result = await prepareLegacyTranscriptImport({
      agent,
      sessionId: 'conversation',
      options: { filePath }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.error)
    }
    expect(result.items).toHaveLength(agent === 'cursor' ? 2 : 4)
    expect(result.items[0]).toMatchObject({
      identity: { provider: 'legacy', agent, sessionId: 'conversation' },
      body: { kind: 'message', role: 'user' }
    })
  }
)
