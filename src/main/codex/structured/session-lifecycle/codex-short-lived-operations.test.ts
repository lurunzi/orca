import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { agentJournalItemKey } from '../../../../shared/agent-session/journal/agent-session-journal-item-key'
import type { StructuredAgentSessionConversationCopyInput } from '../../../native-chat/agent-session-wire/providers/structured-agent-session-conversation-copy-input'
import { readCodexLocalHistory } from '../../../native-chat/codex-local-history'
import type * as LocalHistory from '../../../native-chat/codex-local-history'
import { codexPoolProviderProbeCwd } from './codex-pool-provider-invocation'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  AgentSessionPoolAccountOrigin,
  type CodexPoolIdentity
} from '../../../../shared/agent-session/lifecycle/agent-session-pool-account'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import {
  DashboardAllocationError,
  DashboardAllocationState,
  DashboardToolProvider,
  type DashboardCodexAllocation
} from '../../../dashboard-accounts/dashboard-allocation-protocol'
import {
  readDashboardCodexAllocation,
  readDashboardCodexAllocationContext
} from '../../../dashboard-accounts/dashboard-allocation-reader'
import { DashboardCodexRefreshMailbox } from '../../../dashboard-accounts/dashboard-codex-refresh-mailbox'
import {
  DashboardCodexRefreshOperation,
  DashboardCodexRefreshSource
} from '../../../dashboard-accounts/dashboard-codex-refresh-protocol'
import {
  spawnCodexAppServerProcess,
  type CodexAppServerSpawn
} from '../../app-server/codex-app-server-process-tree-kill'
import {
  runCodexAppServerSession,
  type CodexAppServerRpc
} from '../../app-server/codex-app-server-session'
import { readCodexSessionAccountUsageForAccount } from './codex-pool-session-account-usage'
import { CodexStructuredSessionAdapter } from './codex-structured-session-adapter'
import {
  resolveCodexHomeProcessLockKey,
  withCodexHomeProcessLock
} from '../../../codex-cli/codex-home-process-lock'
import {
  CodexShortLivedOperations,
  type CodexPreparedShortLivedInvocation
} from './codex-short-lived-operations'

vi.mock('../../../dashboard-accounts/dashboard-allocation-reader', () => ({
  readDashboardCodexAllocation: vi.fn(),
  readDashboardCodexAllocationContext: vi.fn()
}))

vi.mock('../../../native-chat/codex-local-history', async (importOriginal) => {
  const original = await importOriginal<typeof LocalHistory>()
  return { ...original, readCodexLocalHistory: vi.fn(original.readCodexLocalHistory) }
})

const copyHomes = new Set<string>()
const SOURCE_THREAD = '00000000-0000-4000-8000-000000000001'
const CHILD_THREAD = '00000000-0000-4000-8000-000000000002'

const allocation: DashboardCodexAllocation = {
  provider: DashboardToolProvider.Codex,
  state: DashboardAllocationState.Available,
  account_id: 'pool-fixture',
  binding_revision: 3,
  credential_version: 4,
  access_token: 'private-old-access',
  chatgpt_account_id: 'workspace-fixture',
  expires_at: null
}
const next = { ...allocation, credential_version: 5, access_token: 'private-new-access' }
const owners = new Set<Pick<CodexShortLivedOperations, 'closeAll'>>()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function record(): AgentSessionRecord {
  return {
    schemaVersion: 2,
    sessionId: 'session-fixture',
    provider: 'codex',
    providerHandleChain: [],
    accountHome: { variable: 'CODEX_HOME', path: join(tmpdir(), 'orca-short-lived-fixture') },
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-fixture',
      workspaceKind: 'folder'
    },
    poolAccount: {
      version: 1,
      origin: AgentSessionPoolAccountOrigin.Authenticated,
      instanceId: 'instance-fixture',
      provider: DashboardToolProvider.Codex,
      accountId: 'pool-fixture',
      bindingRevision: 3,
      credentialVersion: 4
    },
    lease: {
      sessionId: 'session-fixture',
      runtimeKind: 'native',
      runtimeFence: 77,
      handoffStage: null,
      provenHandleLinkId: null,
      ownerProcess: {
        hostId: 'old-host',
        pid: 999999,
        processStartTimeMs: 1,
        spawnToken: 'old-spawn'
      },
      reservedSpawnToken: null,
      leaseDeadlineAt: 0,
      lastRenewedAt: 0,
      handoffOperationId: null,
      claimKeyId: 'claim-fixture',
      claimStatus: 'released',
      unreconciled: false,
      deathEvidence: null
    },
    createdAt: 1,
    updatedAt: 1
  }
}

const SERVER = String.raw`
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n')
const events = []
let accountRequest
let renameFailed = false
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ id: 'unsupported', method: 'test/unknown', params: { secret: 'private-request' } })
    send({ id: message.id, result: { userAgent: 'codex/0.166.0' } })
  }
  if (message.id === 'unsupported' && !message.method) events.push(message.error)
  if (message.method === 'initialized') events.push('initialized')
  if (message.method === 'account/login/start') {
    events.push('login')
    send({ id: message.id, result: { type: 'chatgptAuthTokens' } })
    send({ method: 'account/login/completed', params: { loginId: null, success: true, error: null } })
    send({ method: 'account/updated', params: { authMode: 'chatgptAuthTokens' } })
  }
  if (message.method === 'account/read') {
    events.push('account_read')
    accountRequest = message.id
    if (process.env.ORCA_TEST_REFRESH === '1') {
      send({ id: 'refresh-fixture', method: 'account/chatgptAuthTokens/refresh', params: {
        reason: 'unauthorized', previousAccountId: 'workspace-fixture'
      } })
    } else finishAccount()
  }
  if (message.id === 'refresh-fixture' && message.result) {
    events.push('refresh_reply')
    finishAccount()
  }
  if (message.method === 'account/rateLimits/read') {
    send({ id: message.id, result: { rateLimits: {
      primary: { usedPercent: 25, windowDurationMins: 300 },
      secondary: { usedPercent: 50, windowDurationMins: 10080 }
    } } })
  }
  if (message.method === 'thread/read') {
    send({ id: message.id, result: { thread: { id: message.params.threadId, historyMode: 'paginated' } } })
  }
  if (message.method === 'thread/turns/list') {
    send({ id: message.id, result: { data: [{ id: 'copy-turn', status: 'completed' }], nextCursor: null } })
  }
  if (message.method === 'thread/fork') {
    if (process.env.ORCA_TEST_PERSONAL_COPY_ERROR === '1') {
      send({ id: message.id, error: { code: -32000, message: 'active turn is running' } })
      return
    }
    if (!events.includes('login') || !events.includes('account_read') ||
        message.params.threadId !== '00000000-0000-4000-8000-000000000001' ||
        message.params.lastTurnId !== 'copy-turn' || process.env.ORCA_TEST_COPY_FAIL === '1') {
      send({ id: message.id, error: { code: -32000, message: 'private-copy-rejection' } })
    } else send({ id: message.id, result: { thread: { id: '00000000-0000-4000-8000-000000000002' } } })
  }
  if (message.method === 'thread/name/set') {
    if (!events.includes('login') || !events.includes('account_read') ||
        message.params.threadId !== 'thread-fixture' || message.params.name !== 'Pool rename') {
      send({ id: message.id, error: { code: -32000, message: 'private-invalid-rename' } })
    } else if (process.env.ORCA_TEST_RENAME_FAIL_ONCE === '1' && !renameFailed) {
      renameFailed = true
      send({ id: message.id, error: { code: -32000, message: 'rollout at private-provider-path is empty' } })
    } else send({ id: message.id, result: {} })
  }
  if (message.method === 'test/body') {
    if (process.env.ORCA_TEST_REFRESH_AFTER_AUTH === '1') {
      send({ id: 'refresh-after-auth', method: 'account/chatgptAuthTokens/refresh', params: {
        reason: 'unauthorized', previousAccountId: 'workspace-fixture'
      } })
      return
    }
    events.push('body')
    send({ id: message.id, result: {
      events,
      env: {
        apiKey: process.env.OPENAI_API_KEY ?? null,
        codexKey: process.env.CODEX_API_KEY ?? null,
        baseUrl: process.env.OPENAI_BASE_URL ?? null,
        home: process.env.CODEX_HOME,
        proxy: process.env.HTTPS_PROXY,
        spawnToken: process.env.ORCA_AGENT_SESSION_SPAWN_TOKEN
      }
    } })
  }
})
function finishAccount() {
  send({ id: accountRequest, result: {
    account: { type: 'chatgpt' }, requiresOpenaiAuth: true,
    workspaceRouting: { chatgptAccountId: 'workspace-fixture' }
  } })
}
`

function prepared(refresh = false): CodexPreparedShortLivedInvocation {
  return {
    cwd: __dirname,
    invocation: {
      command: process.execPath,
      cliPath: null,
      args: ['-e', SERVER],
      cwd: __dirname,
      env: {
        ORCA_TEST_REFRESH: refresh ? '1' : '0',
        CODEX_HOME: join(tmpdir(), 'orca-short-lived-fixture'),
        OPENAI_API_KEY: 'private-explicit-key',
        CODEX_API_KEY: 'private-codex-key',
        OPENAI_BASE_URL: 'https://private.invalid',
        HTTPS_PROXY: 'http://proxy.invalid'
      },
      timeoutMs: 1,
      treeKillOnFinish: true
    }
  }
}

function coldAdapter() {
  const adapter = new CodexStructuredSessionAdapter({
    hostId: 'host-fixture',
    readProcessStartTime: async () => 1234.5,
    resolveLaunch: async () => {
      throw new Error('unexpected long acquisition')
    },
    providerInvocation: {
      resolveCommand: () => ({ command: process.execPath, prefixArgs: ['-e', SERVER, '--'] }),
      resolveLaunchArgs: () => [],
      resolveWorkspacePath: async () => __dirname,
      resolveEnvironment: async () => ({ ...process.env, ...prepared().invocation.env })
    }
  })
  owners.add(adapter)
  return adapter
}

async function poolCopyInput(): Promise<StructuredAgentSessionConversationCopyInput> {
  const home = await mkdtemp(join(tmpdir(), 'orca-pool-copy-'))
  copyHomes.add(home)
  await mkdir(join(home, 'sessions'), { recursive: true })
  const rows = [
    { type: 'session_meta', payload: { id: SOURCE_THREAD, history_mode: 'paginated' } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'copy-turn' } },
    ...['UserMessage', 'AgentMessage'].map((type, index) => ({
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        item: {
          type,
          id: `copy-item-${index}`,
          content: [{ type: 'text', text: 'Saved copy fixture' }]
        }
      }
    })),
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'copy-turn' } }
  ]
  await writeFile(
    join(home, 'sessions', `rollout-2026-11-04T00-00-00-${SOURCE_THREAD}.jsonl`),
    `${rows.map((row, ordinal) => JSON.stringify({ ...row, ordinal })).join('\n')}\n`
  )
  const source = record()
  source.accountHome = { variable: 'CODEX_HOME', path: home }
  source.poolAccount = {
    version: 1,
    origin: AgentSessionPoolAccountOrigin.Authenticated,
    instanceId: 'instance-fixture',
    provider: DashboardToolProvider.Codex,
    accountId: 'pool-fixture',
    bindingRevision: 2,
    credentialVersion: 2
  }
  return {
    record: source,
    accountHome: source.accountHome,
    providerSessionId: SOURCE_THREAD,
    identity: {
      sessionId: source.sessionId,
      workspaceId: 'workspace-fixture',
      hostId: 'local',
      agent: 'codex',
      providerHandle: null
    },
    checkpoint: {
      settled: true,
      turnId: 'copy-turn',
      selectedItemId: agentJournalItemKey({
        provider: 'legacy',
        agent: 'codex',
        sessionId: SOURCE_THREAD,
        recordId: `${SOURCE_THREAD}:copy-item-1`
      })
    }
  }
}

function fixture() {
  const mailbox = new DashboardCodexRefreshMailbox()
  let written = (): string[] => []
  let pid: number | undefined
  const spawn: CodexAppServerSpawn = (program, args, options) => {
    const child = spawnCodexAppServerProcess(program, args, options)
    pid = child.pid
    if (!child.stdin) {
      throw new Error('expected piped stdin')
    }
    const write = vi.spyOn(child.stdin, 'write')
    written = () => write.mock.calls.map(([chunk]) => String(chunk))
    return child
  }
  const runSession: typeof runCodexAppServerSession = (invocation, body, _spawn, hooks) =>
    runCodexAppServerSession(invocation, body, spawn, hooks)
  const owner = new CodexShortLivedOperations({
    mailbox,
    hostId: 'host-fixture',
    readProcessStartTime: async () => 1234.5,
    runSession
  })
  owners.add(owner)
  return { owner, mailbox, written: () => written(), pid: () => pid }
}

const options = {
  timeoutMs: 10_000,
  operation: DashboardCodexRefreshOperation.ReadAccountUsage
}

beforeEach(() => {
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'instance-fixture')
  vi.stubEnv('ORCA_DASHBOARD_CODEX_AUTH_EXPERIMENT', '1')
  vi.stubEnv('OPENAI_API_KEY', 'private-inherited-key')
  vi.mocked(readDashboardCodexAllocationContext).mockResolvedValue({
    instanceId: 'instance-fixture',
    allocation
  })
})

afterEach(async () => {
  await Promise.all([...owners].map((owner) => owner.closeAll()))
  owners.clear()
  for (const home of copyHomes) {
    const target = resolve(home)
    if (!target.startsWith(resolve(join(tmpdir(), 'orca-pool-copy-')))) {
      throw new Error('unexpected copy fixture cleanup path')
    }
    await rm(target, { recursive: true, force: true })
  }
  copyHomes.clear()
  vi.restoreAllMocks()
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})

it('authenticates before business and refreshes with this short-lived process scope', async () => {
  const f = fixture()
  const reading = deferred<DashboardCodexAllocation | null>()
  const started = deferred<void>()
  vi.mocked(readDashboardCodexAllocation).mockImplementation(() => {
    started.resolve()
    return reading.promise
  })
  const body = vi.fn(
    async (rpc: CodexAppServerRpc, cwd: string, identity: CodexPoolIdentity | null) => {
      expect(cwd).toBe(__dirname)
      expect(identity).toEqual({
        instanceId: 'instance-fixture',
        provider: 'codex',
        accountId: 'pool-fixture',
        bindingRevision: 3,
        credentialVersion: 4
      })
      return rpc.request('test/body')
    }
  )
  const result = f.owner.run(record(), options, async () => prepared(true), body)
  await started.promise
  expect(body).not.toHaveBeenCalled()
  const requests = f.mailbox.read().requests
  expect(requests).toHaveLength(1)
  const request = requests[0]
  if (!request || request.source !== DashboardCodexRefreshSource.ShortLivedOperation) {
    throw new Error('expected a short-lived operation scope')
  }
  expect(request).toMatchObject({
    source: 'short_lived_operation',
    operation: 'read_account_usage',
    source_session_id: 'session-fixture',
    process: { hostId: 'host-fixture', pid: f.pid(), processStartTimeMs: 1234.5 },
    account_id: 'pool-fixture',
    binding_revision: 3,
    credential_version: 4
  })
  expect(request).not.toHaveProperty('fence')
  expect(request).not.toHaveProperty('acquisition_generation')
  expect(request.process.pid).not.toBe(999999)
  expect(request.operation_id).not.toBe(request.process.spawnToken)
  reading.resolve(next)
  await expect(result).resolves.toEqual({
    events: [
      { code: -32601, message: 'Method not supported' },
      'initialized',
      'login',
      'account_read',
      'refresh_reply',
      'body'
    ],
    env: {
      apiKey: null,
      codexKey: null,
      baseUrl: null,
      home: join(tmpdir(), 'orca-short-lived-fixture'),
      proxy: 'http://proxy.invalid',
      spawnToken: request.process.spawnToken
    }
  })
  expect(f.mailbox.read()).toEqual({ requests: [] })
})

it('copies after authentication and returns only the same-operation pool identity', async () => {
  const adapter = coldAdapter()
  await expect(adapter.copyConversation(await poolCopyInput())).resolves.toEqual({
    sessionId: CHILD_THREAD,
    coverage: { unit: 'codex-turn', ids: ['copy-turn'] },
    poolCopy: {
      provider: 'codex',
      sourceSessionId: 'session-fixture',
      sourceProviderSessionId: SOURCE_THREAD,
      targetProviderSessionId: CHILD_THREAD,
      identity: {
        instanceId: 'instance-fixture',
        provider: 'codex',
        accountId: 'pool-fixture',
        bindingRevision: 3,
        credentialVersion: 4
      }
    }
  })
  expect(adapter.readDashboardCodexProcesses()).toEqual({ pending_acquisitions: 0, processes: [] })
})

it('keeps provider copy failure fixed without publishing a receipt or cause', async () => {
  vi.stubEnv('ORCA_TEST_COPY_FAIL', '1')
  const adapter = coldAdapter()
  const result = adapter.copyConversation(await poolCopyInput())
  await expect(result).rejects.toMatchObject({ message: 'dashboard_allocation_unavailable' })
  await expect(result).rejects.not.toHaveProperty('cause')
})

it('preserves the personal active-turn refusal through owned adapter cleanup', async () => {
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', undefined)
  vi.stubEnv('ORCA_TEST_PERSONAL_COPY_ERROR', '1')
  const input = await poolCopyInput()
  delete input.record!.poolAccount
  const adapter = coldAdapter()
  await expect(adapter.copyConversation(input)).rejects.toMatchObject({
    message: 'Codex could not verify the copied chat.'
  })
})

it('registers copy before history preparation so shutdown cancels a stalled file read', async () => {
  const adapter = coldAdapter()
  const started = deferred<void>()
  const reading = deferred<number>()
  vi.mocked(readCodexLocalHistory).mockImplementationOnce(() => {
    started.resolve()
    return reading.promise
  })
  const input = await poolCopyInput()
  // Without a turn the copy reads the saved history before it starts the app-server.
  delete input.checkpoint!.turnId
  const result = adapter.copyConversation(input)
  const rejected = expect(result).rejects.toMatchObject({
    message: 'dashboard_allocation_unavailable'
  })
  await started.promise
  await adapter.closeAll()
  await rejected
  reading.resolve(0)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(adapter.readDashboardCodexRefreshes()).toEqual({ requests: [] })
})

it('renames a cold pool thread through the real adapter only after authentication', async () => {
  const adapter = coldAdapter()
  await expect(
    adapter.renameProviderSession({
      record: record(),
      providerSessionId: 'thread-fixture',
      name: 'Pool rename'
    })
  ).resolves.toBeUndefined()
  expect(adapter.readDashboardCodexProcesses()).toEqual({ pending_acquisitions: 0, processes: [] })
})

it('does not retry a failed pool rename even if a second request would succeed', async () => {
  vi.stubEnv('ORCA_TEST_RENAME_FAIL_ONCE', '1')
  const adapter = coldAdapter()
  const result = adapter.renameProviderSession({
    record: record(),
    providerSessionId: 'thread-fixture',
    name: 'Pool rename'
  })
  await expect(result).rejects.toMatchObject({ message: 'dashboard_allocation_unavailable' })
  await expect(result).rejects.not.toHaveProperty('cause')
})

it('cancels cold rename while its allocation snapshot is waiting', async () => {
  const waiting = deferred<void>()
  const reading = deferred<Awaited<ReturnType<typeof readDashboardCodexAllocationContext>>>()
  vi.mocked(readDashboardCodexAllocationContext).mockImplementation(() => {
    waiting.resolve()
    return reading.promise
  })
  const adapter = coldAdapter()
  const cancel = new AbortController()
  const result = adapter.renameProviderSession({
    record: record(),
    providerSessionId: 'thread-fixture',
    name: 'Pool rename',
    signal: cancel.signal
  })
  const rejected = expect(result).rejects.toMatchObject({
    message: 'dashboard_allocation_unavailable'
  })
  await waiting.promise
  cancel.abort(new Error('private-cancelled-rename'))
  await rejected
  reading.resolve({ instanceId: 'instance-fixture', allocation })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(adapter.readDashboardCodexRefreshes()).toEqual({ requests: [] })
})

it('reads cold quota through the invocation preparation and owned authentication path', async () => {
  const f = fixture()
  const read = readCodexSessionAccountUsageForAccount(
    new Map(),
    () => ({
      resolveCommand: () => ({ command: process.execPath, prefixArgs: ['-e', SERVER, '--'] }),
      resolveLaunchArgs: () => [],
      resolveWorkspacePath: async () => __dirname,
      resolveEnvironment: async () => ({ ...process.env, ...prepared().invocation.env })
    }),
    f.owner
  )
  await expect(read(record(), new AbortController().signal)).resolves.toMatchObject({
    pool: true,
    account: { type: 'chatgpt' },
    rateLimits: {
      provider: 'codex',
      status: 'ok',
      error: null,
      session: { usedPercent: 25, windowMinutes: 300 },
      weekly: { usedPercent: 50, windowMinutes: 10080 }
    }
  })
  const methods = f.written().flatMap((line) => {
    const message = JSON.parse(line)
    return typeof message.method === 'string' ? [message.method] : []
  })
  expect(methods).toEqual([
    'initialize',
    'initialized',
    'account/login/start',
    'account/read',
    'account/read',
    'account/rateLimits/read'
  ])
})

it('cancels directory preparation before a late resolver can create a fallback directory', async () => {
  const root = join(tmpdir(), `orca-cancelled-probe-${randomUUID()}`)
  vi.stubEnv('ORCA_USER_DATA_PATH', root)
  const cancel = new AbortController()
  const workspace = deferred<string>()
  const error = new Error('cancelled-directory-preparation')
  const probing = codexPoolProviderProbeCwd(
    record(),
    {
      resolveLaunchArgs: () => [],
      resolveWorkspacePath: () => workspace.promise
    },
    cancel.signal
  )
  const rejected = expect(probing).rejects.toBe(error)
  cancel.abort(error)
  await rejected
  workspace.resolve(join(root, 'missing-workspace'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('preserves per-home serialization for owned personal quota operations', async () => {
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', undefined)
  const f = fixture()
  const personal = record()
  delete personal.poolAccount
  const held = deferred<void>()
  const release = deferred<void>()
  const external = withCodexHomeProcessLock(
    resolveCodexHomeProcessLockKey(join(tmpdir(), 'orca-short-lived-fixture')),
    async () => {
      held.resolve()
      await release.promise
    }
  )
  await held.promise
  const prepare = vi.fn(async () => prepared())
  const result = f.owner.run(personal, { ...options, serializeHome: true }, prepare, (rpc) =>
    rpc.request('test/body')
  )
  try {
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(prepare).not.toHaveBeenCalled()
    expect(f.pid()).toBeUndefined()
    release.resolve()
    await external
    await expect(result).resolves.toMatchObject({
      events: [{ code: -32601, message: 'Method not supported' }, 'initialized', 'body']
    })
  } finally {
    release.resolve()
    await external
    await result.catch(() => undefined)
  }
})

it('closeAll cancels an authentication file read and never replies or runs late business', async () => {
  const f = fixture()
  const reading = deferred<DashboardCodexAllocation | null>()
  const started = deferred<void>()
  vi.mocked(readDashboardCodexAllocation).mockImplementation(() => {
    started.resolve()
    return reading.promise
  })
  const body = vi.fn(async () => 'unexpected')
  const result = f.owner.run(record(), options, async () => prepared(true), body)
  const rejected = expect(result).rejects.toBeInstanceOf(DashboardAllocationError)
  await started.promise
  expect(f.mailbox.read().requests).toHaveLength(1)
  const closing = f.owner.closeAll()
  expect(f.mailbox.read()).toEqual({ requests: [] })
  await closing
  await rejected
  reading.resolve(next)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(body).not.toHaveBeenCalled()
  expect(f.written().join('')).not.toContain('private-new-access')
  expect(f.written().join('')).not.toContain('"method":"test/body"')
})

it('terminates this short operation if a refresh fails after authentication', async () => {
  const f = fixture()
  vi.mocked(readDashboardCodexAllocation).mockRejectedValue(new Error('private-refresh-failure'))
  const invocation = prepared()
  invocation.invocation.env = {
    ...invocation.invocation.env,
    ORCA_TEST_REFRESH_AFTER_AUTH: '1'
  }
  await expect(
    f.owner.run(
      record(),
      options,
      async () => invocation,
      (rpc) => rpc.request('test/body')
    )
  ).rejects.toMatchObject({
    message: 'dashboard_allocation_unavailable'
  })
  expect(f.mailbox.read()).toEqual({ requests: [] })
})

it('cancels hanging preparation and queued work without a late spawn after closeAll', async () => {
  const f = fixture()
  const cancel = new AbortController()
  const preparing = deferred<void>()
  const preparation = deferred<CodexPreparedShortLivedInvocation>()
  const first = f.owner.run(
    record(),
    { ...options, signal: cancel.signal },
    async () => {
      preparing.resolve()
      return preparation.promise
    },
    async () => 'unexpected'
  )
  const firstRejected = expect(first).rejects.toBeInstanceOf(DashboardAllocationError)
  await preparing.promise
  const latePrepare = vi.fn(async () => prepared())
  const second = f.owner.run(record(), options, latePrepare, async () => 'unexpected')
  const secondRejected = expect(second).rejects.toBeInstanceOf(DashboardAllocationError)
  cancel.abort(new Error('private-cancellation'))
  await f.owner.closeAll()
  await Promise.all([firstRejected, secondRejected])
  preparation.resolve(prepared())
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(latePrepare).not.toHaveBeenCalled()
  expect(f.pid()).toBeUndefined()
  await expect(
    f.owner.run(record(), options, latePrepare, async () => null)
  ).rejects.toBeInstanceOf(DashboardAllocationError)
})

it('sanitizes pool business errors while preserving personal authentication and error semantics', async () => {
  const f = fixture()
  const privateError = new Error('private-provider-message', { cause: 'private-cause' })
  const pooled = await f.owner
    .run(
      record(),
      options,
      async () => prepared(),
      async (rpc) => {
        await rpc.request('test/body')
        throw privateError
      }
    )
    .catch((error: unknown) => error)
  expect(pooled).toBeInstanceOf(DashboardAllocationError)
  expect(pooled).toMatchObject({ message: 'dashboard_allocation_unavailable' })
  expect(pooled).not.toHaveProperty('cause')
  expect(String(pooled)).not.toContain('private-provider-message')

  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', undefined)
  const personal = record()
  delete personal.poolAccount
  const result = f.owner.run(
    personal,
    options,
    async () => prepared(),
    async (rpc, _cwd, identity) => {
      expect(identity).toBeNull()
      await expect(rpc.request('test/body')).resolves.toMatchObject({
        events: [{ code: -32601, message: 'Method not supported' }, 'initialized', 'body'],
        env: { apiKey: 'private-explicit-key', codexKey: 'private-codex-key' }
      })
      throw privateError
    }
  )
  await expect(result).rejects.toBe(privateError)
})
