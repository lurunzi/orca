import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readNativeChatTranscript } from './transcript-reader'
import {
  nativeChatLineDecoderForAgent,
  readNativeChatTranscriptTailFile
} from './transcript-tail-reader'

let tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

function jsonLines(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n')
}

async function writeFixture(prefix: string, records: unknown[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  tempRoots.push(root)
  const filePath = join(root, 'transcript.jsonl')
  await writeFile(filePath, jsonLines(records))
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

describe('readNativeChatTranscriptTailFile', () => {
  it('windows to nothing for a non-positive limit instead of the whole tail', async () => {
    const decode = nativeChatLineDecoderForAgent('claude')!
    const filePath = await writeFixture('orca-native-chat-tail-limit-', [
      {
        type: 'assistant',
        uuid: 'a-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'one' }] }
      },
      {
        type: 'assistant',
        uuid: 'a-2',
        message: { role: 'assistant', content: [{ type: 'text', text: 'two' }] }
      }
    ])

    const result = await readNativeChatTranscriptTailFile(filePath, 0, decode, true)

    expect(result.messages).toEqual([])
    expect(result.hasMore).toBe(false)
  })
})
