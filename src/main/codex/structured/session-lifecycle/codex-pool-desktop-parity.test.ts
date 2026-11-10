import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { agentJournalItemKey } from '../../../../shared/agent-session/journal/agent-session-journal-item-key'
import { agentSessionRecordFixture } from '../../../native-chat/agent-session-record-test-fixture'
import { CodexStructuredSessionAdapter } from './codex-structured-session-adapter'

const SOURCE = '00000000-0000-4000-8000-000000000001'
const CHILD = '00000000-0000-4000-8000-000000000002'
const CLEAN = '{"replied":false,"spawnToken":null}'

// Rejects business calls when the short-lived pool runner launched it: spawn token or -32601 reply.
const SERVER = String.raw`
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n')
let replied = false
const evidence = () => JSON.stringify({ replied, spawnToken: process.env.ORCA_AGENT_SESSION_SPAWN_TOKEN ?? null })
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === 'probe' && !message.method) replied = true
  if (message.method === 'initialize') {
    send({ id: 'probe', method: 'test/unknown', params: {} })
    send({ id: message.id, result: {} })
  }
  const dirty = evidence() !== '${CLEAN}'
  const reply = (result) => send(dirty ? { id: message.id, error: { code: -32000, message: evidence() } } : { id: message.id, result })
  if (message.method === 'account/read') reply({ account: { type: 'chatgpt', email: evidence() } })
  if (message.method === 'account/rateLimits/read') reply({})
  if (message.method === 'thread/name/set') reply({})
  if (message.method === 'thread/fork') reply({ thread: { id: '${CHILD}' } })
})
`

let home: string
let adapter: CodexStructuredSessionAdapter

beforeEach(async () => {
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', undefined)
  vi.stubEnv('ORCA_AGENT_SESSION_SPAWN_TOKEN', undefined)
  home = await mkdtemp(join(tmpdir(), 'orca-codex-desktop-parity-'))
  await mkdir(join(home, 'sessions'), { recursive: true })
  const rows = [
    { type: 'session_meta', payload: { id: SOURCE, history_mode: 'paginated' } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
    ...['UserMessage', 'AgentMessage'].map((type, index) => ({
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        item: { type, id: `item-${index}`, content: [{ type: 'text', text: 'fixture' }] }
      }
    })),
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } }
  ]
  await writeFile(
    join(home, 'sessions', `rollout-2026-11-04T00-00-00-${SOURCE}.jsonl`),
    `${rows.map((row, ordinal) => JSON.stringify({ ...row, ordinal })).join('\n')}\n`
  )
  adapter = new CodexStructuredSessionAdapter({
    hostId: 'host-fixture',
    resolveLaunch: async () => {
      throw new Error('unexpected long acquisition')
    },
    providerInvocation: {
      resolveCommand: () => ({ command: process.execPath, prefixArgs: ['-e', SERVER, '--'] }),
      resolveLaunchArgs: () => [],
      resolveWorkspacePath: async () => home,
      resolveEnvironment: async () => ({ ...process.env, CODEX_HOME: home })
    }
  })
})

afterEach(async () => {
  await adapter.closeAll()
  await rm(home, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function personal() {
  return agentSessionRecordFixture({
    sessionId: 'personal-session',
    provider: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: home }
  })
}

it('runs personal cold usage, rename and copy on the plain app-server session', async () => {
  const record = personal()
  await expect(adapter.readAccountUsage(record, new AbortController().signal)).resolves.toEqual({
    account: { type: 'chatgpt', email: CLEAN },
    rateLimits: expect.anything()
  })
  await expect(
    adapter.renameProviderSession({ record, providerSessionId: SOURCE, name: 'Personal rename' })
  ).resolves.toBeUndefined()
  await expect(
    adapter.copyConversation({
      record,
      accountHome: record.accountHome,
      providerSessionId: SOURCE,
      identity: {
        sessionId: record.sessionId,
        workspaceId: 'workspace-1',
        hostId: 'local',
        agent: 'codex',
        providerHandle: null
      },
      checkpoint: {
        settled: true,
        turnId: 'turn-1',
        selectedItemId: agentJournalItemKey({
          provider: 'legacy',
          agent: 'codex',
          sessionId: SOURCE,
          recordId: `${SOURCE}:item-1`
        })
      }
    })
  ).resolves.toEqual({ sessionId: CHILD })
})
