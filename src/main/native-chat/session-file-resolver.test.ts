import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveSessionFilePath } from './session-file-resolver'

let tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

async function makeRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

describe('resolveSessionFilePath', () => {
  it('resolves Cursor sessions only from the AI Vault agent-transcripts layout', async () => {
    const root = await makeRoot('orca-native-chat-resolve-cursor-')
    const cursorProjectsDir = join(root, 'cursor-projects')
    const projectDir = join(cursorProjectsDir, 'project')
    const targetDir = join(projectDir, 'agent-transcripts')
    await mkdir(targetDir, { recursive: true })
    await writeFile(join(projectDir, 'cursor-session.jsonl'), '{}\n')
    const target = join(targetDir, 'cursor-session.jsonl')
    await writeFile(target, '{}\n')

    await expect(
      resolveSessionFilePath('cursor', 'cursor-session', { cursorProjectsDir })
    ).resolves.toBe(target)
  })
})
