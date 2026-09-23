import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { AgentSessionStatusEvent } from '../../shared/agent-session-wire'

const hostRef: { current: unknown } = { current: null }
const gateFacts: { current: { turnRunning: boolean; awaitingHuman: boolean } | null } = {
  current: { turnRunning: false, awaitingHuman: false }
}

vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => hostRef.current
}))
vi.mock('./orchestration/structured-mailbox-pointer-host', () => ({
  readStructuredSessionGateFacts: () => gateFacts.current
}))

const { OrchestrationDb } = await import('./orchestration/db')
const {
  bindStructuredSessionCoordinatorIdentities,
  readStructuredSessionCoordinatorIdentity,
  resetStructuredSessionCoordinatorIdentitiesForTest,
  setStructuredSessionCoordinatorIdentity
} = await import('./structured-session-coordinator-identity')
const { resolveStructuredWorkerAuthority } = await import('./structured-worker-authority')
const {
  mintStructuredWorkerHandle,
  mintStructuredWorkerPaneKey,
  structuredWorkerIdentities,
  structuredWorkerProcessIncarnation
} = await import('./structured-worker-identity')
const { structuredWorkerChildIdentityEnv } = await import('./structured-worker-child-identity-env')

const SESSION_ID = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0'

type FakeHost = {
  deps: { store: { getRecord: (sessionId: string) => AgentSessionRecord | null } }
  hasSession: (sessionId: string) => boolean
  eventRecovery: { restartProviderChild: ReturnType<typeof vi.fn> }
  subscribeStatus: (subscriber: { emit: (event: AgentSessionStatusEvent) => void }) => () => void
  emitStatus: (sessionId: string) => void
}

function installHost(options: { attached?: boolean; wslDistro?: string | null } = {}): FakeHost {
  const listeners: ((event: AgentSessionStatusEvent) => void)[] = []
  const host: FakeHost = {
    deps: {
      store: {
        getRecord: (sessionId) =>
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test record carries only the fields the grant reads.
          ({
            sessionId,
            provider: 'claude',
            location: {
              executionHostId: 'local',
              wslDistro: options.wslDistro ?? null,
              workspaceId: 'wt_1',
              workspaceKind: 'git-worktree'
            },
            lease: { runtimeKind: 'native', claimStatus: 'live', runtimeFence: 1 }
          }) as unknown as AgentSessionRecord
      }
    },
    hasSession: () => options.attached ?? true,
    eventRecovery: { restartProviderChild: vi.fn(async () => true) },
    subscribeStatus: (subscriber) => {
      listeners.push(subscriber.emit)
      return () => undefined
    },
    emitStatus: (sessionId) => {
      for (const emit of listeners) {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the redrive reads only sessionId.
        emit({ type: 'status', session: { sessionId } as never })
      }
    }
  }
  hostRef.current = host
  return host
}

function makeDeps(db: InstanceType<typeof OrchestrationDb>) {
  return {
    getDb: () => db,
    ensureHost: vi.fn(async () => undefined),
    onSessionActivity: vi.fn(),
    forgetSessionMail: vi.fn()
  }
}

describe('granting a user-opened structured chat a coordinator identity', () => {
  let db: InstanceType<typeof OrchestrationDb>

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    structuredWorkerIdentities.clear()
    resetStructuredSessionCoordinatorIdentitiesForTest()
    gateFacts.current = { turnRunning: false, awaitingHuman: false }
  })

  afterEach(() => {
    db.close()
    hostRef.current = null
  })

  it('persists a grant, restarts the idle child, and resolves as a live authority', async () => {
    const host = installHost()
    const deps = makeDeps(db)

    expect(await readStructuredSessionCoordinatorIdentity(deps, SESSION_ID)).toEqual({
      state: 'disabled'
    })
    expect(await setStructuredSessionCoordinatorIdentity(deps, SESSION_ID, true)).toEqual({
      state: 'enabled'
    })

    const row = db.getActiveStructuredSessionIdentityBySessionId(SESSION_ID)
    expect(row?.terminal_handle.startsWith('structworker_')).toBe(true)
    expect(host.eventRecovery.restartProviderChild).toHaveBeenCalledWith(
      SESSION_ID,
      expect.any(String)
    )
    const authority = resolveStructuredWorkerAuthority(row!.terminal_handle, db)
    expect(authority?.identity).toMatchObject({
      sessionId: SESSION_ID,
      worktreeId: 'wt_1',
      origin: 'session'
    })
    // The restarted child is what carries it; an ordinary chat gets only the refusal marker.
    expect(structuredWorkerChildIdentityEnv(SESSION_ID, {}).ORCA_TERMINAL_HANDLE).toBe(
      row!.terminal_handle
    )
    expect(await readStructuredSessionCoordinatorIdentity(deps, SESSION_ID)).toEqual({
      state: 'enabled'
    })
  })

  it('refuses while a turn is running rather than interrupting it', async () => {
    const host = installHost()
    gateFacts.current = { turnRunning: true, awaitingHuman: false }

    expect(await setStructuredSessionCoordinatorIdentity(makeDeps(db), SESSION_ID, true)).toEqual({
      state: 'unavailable',
      reason: 'busy'
    })
    expect(db.getActiveStructuredSessionIdentityBySessionId(SESSION_ID)).toBeUndefined()
    expect(host.eventRecovery.restartProviderChild).not.toHaveBeenCalled()
  })

  it('grants a detached session without a restart; its next spawn reads the grant', async () => {
    const host = installHost({ attached: false })

    await setStructuredSessionCoordinatorIdentity(makeDeps(db), SESSION_ID, true)

    expect(host.eventRecovery.restartProviderChild).not.toHaveBeenCalled()
    expect(db.getActiveStructuredSessionIdentityBySessionId(SESSION_ID)).toBeDefined()
  })

  it('refuses a session that does not run natively on this host', async () => {
    installHost({ wslDistro: 'Ubuntu' })

    expect(await setStructuredSessionCoordinatorIdentity(makeDeps(db), SESSION_ID, true)).toEqual({
      state: 'unavailable',
      reason: 'not-local'
    })
  })

  it('leaves a dispatched worker identity alone', async () => {
    installHost()
    structuredWorkerIdentities.register({
      handle: mintStructuredWorkerHandle(),
      sessionId: SESSION_ID,
      agent: 'claude',
      paneKey: mintStructuredWorkerPaneKey(SESSION_ID),
      processIncarnation: structuredWorkerProcessIncarnation(SESSION_ID),
      worktreeId: 'wt_1',
      hostScope: { kind: 'local', hostId: 'local' }
    })

    expect(await setStructuredSessionCoordinatorIdentity(makeDeps(db), SESSION_ID, true)).toEqual({
      state: 'worker'
    })
    expect(db.getActiveStructuredSessionIdentityBySessionId(SESSION_ID)).toBeUndefined()
  })

  it('revokes: the handle stops resolving and parked mail is dropped', async () => {
    installHost()
    const deps = makeDeps(db)
    await setStructuredSessionCoordinatorIdentity(deps, SESSION_ID, true)
    const handle = db.getActiveStructuredSessionIdentityBySessionId(SESSION_ID)!.terminal_handle

    expect(await setStructuredSessionCoordinatorIdentity(deps, SESSION_ID, false)).toEqual({
      state: 'disabled'
    })

    expect(resolveStructuredWorkerAuthority(handle, db)).toBeNull()
    expect(deps.forgetSessionMail).toHaveBeenCalledWith(SESSION_ID)
    expect(structuredWorkerChildIdentityEnv(SESSION_ID, {}).ORCA_TERMINAL_HANDLE).toBeUndefined()
  })

  it('survives a restart: the grant reloads from the database for the next spawn', async () => {
    installHost()
    const deps = makeDeps(db)
    await setStructuredSessionCoordinatorIdentity(deps, SESSION_ID, true)
    const handle = db.getActiveStructuredSessionIdentityBySessionId(SESSION_ID)!.terminal_handle

    // A new process: empty registry, host freshly bound.
    structuredWorkerIdentities.clear()
    resetStructuredSessionCoordinatorIdentitiesForTest()
    const host = installHost()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: fake exposes the three members bind reads.
    bindStructuredSessionCoordinatorIdentities({ ...deps, host: host as never })

    expect(structuredWorkerChildIdentityEnv(SESSION_ID, {}).ORCA_TERMINAL_HANDLE).toBe(handle)
    expect(resolveStructuredWorkerAuthority(handle, db)?.identity.origin).toBe('session')
  })

  it('redrives parked coordinator mail on status edges of granted sessions only', async () => {
    const host = installHost()
    const deps = makeDeps(db)
    await setStructuredSessionCoordinatorIdentity(deps, SESSION_ID, true)

    host.emitStatus(SESSION_ID)
    host.emitStatus('some-other-session')

    expect(deps.onSessionActivity).toHaveBeenCalledTimes(1)
    expect(deps.onSessionActivity).toHaveBeenCalledWith(SESSION_ID)
  })
})
