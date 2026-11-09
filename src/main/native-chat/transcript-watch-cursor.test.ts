import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type {
  NativeChatMessage,
  NativeChatTurnLifecycle
} from '../../shared/native-chat/native-chat-types'
import type { NativeChatTranscriptSubscription } from './transcript-watch-contract'
import { subscribeNativeChatTranscript } from './transcript-watch'

const subscriptions = new Set<NativeChatTranscriptSubscription>()
let tempRoots: string[] = []

afterEach(async () => {
  for (const subscription of subscriptions) {
    subscription.unsubscribe()
  }
  subscriptions.clear()
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

function cursorLine(role: 'user' | 'assistant', text: string): string {
  return `${JSON.stringify({ role, message: { content: [{ type: 'text', text }] } })}\n`
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

it('tails Cursor messages and turn lifecycle through the shared watcher', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-native-chat-watch-cursor-'))
  tempRoots.push(root)
  const filePath = join(root, 'transcript.jsonl')
  await writeFile(filePath, cursorLine('user', 'first'))
  const snapshots: NativeChatMessage[][] = []
  const appends: NativeChatMessage[][] = []
  const lifecycles: NativeChatTurnLifecycle[] = []
  const sub = await subscribeNativeChatTranscript({
    agent: 'cursor',
    sessionId: 'ignored',
    filePath,
    onInitialSnapshot: (messages) => snapshots.push(messages),
    onAppend: (messages, lifecycle) => {
      appends.push(messages)
      if (lifecycle) {
        lifecycles.push(lifecycle)
      }
    },
    debounceMs: 5
  })
  subscriptions.add(sub)

  await waitFor(() => snapshots.length === 1)
  await appendFile(
    filePath,
    `${cursorLine('assistant', 'done')}${JSON.stringify({ type: 'turn_ended', status: 'success' })}\n`
  )
  await waitFor(() => appends.flat().some((message) => message.role === 'assistant'))
  await waitFor(() => lifecycles.length === 1)

  expect(snapshots[0]?.[0]).toMatchObject({ role: 'user', timestamp: null })
  expect(appends.flat().at(-1)).toMatchObject({ role: 'assistant', timestamp: null })
  expect(lifecycles[0]).toMatchObject({ state: 'completed', timestamp: null })
})
