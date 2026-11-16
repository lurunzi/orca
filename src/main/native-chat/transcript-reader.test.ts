import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readNativeChatTranscript } from './transcript-reader'

let tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

async function writeFixture(prefix: string, records: unknown[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  tempRoots.push(root)
  const filePath = join(root, 'transcript.jsonl')
  await writeFile(filePath, records.map((record) => JSON.stringify(record)).join('\n'))
  return filePath
}

describe('readNativeChatTranscript (cursor)', () => {
  it('routes Cursor text and tool_use rows through the dedicated decoder', async () => {
    const filePath = await writeFixture('orca-native-chat-cursor-', [
      { role: 'user', message: { content: [{ type: 'text', text: 'Inspect README' }] } },
      {
        role: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', input: { path: 'README.md' } }] }
      },
      { type: 'turn_ended', status: 'success' }
    ])

    const result = await readNativeChatTranscript('cursor', 'cursor-session', { filePath })
    expect('messages' in result && result.messages).toMatchObject([
      { role: 'user', blocks: [{ type: 'text', text: 'Inspect README' }], timestamp: null },
      {
        role: 'assistant',
        blocks: [{ type: 'tool-call', name: 'Read', input: { path: 'README.md' } }],
        timestamp: null
      }
    ])
  })
})
