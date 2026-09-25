import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { createStructuredAgentSessionOwnerProbe } from '../../runtime/structured-agent-session-owner-probe'
import { idleStructuredHandoffStatus } from './structured-agent-session-handoff-status'
import { resolveStructuredSessionRecovery } from './structured-agent-session-recovery-resolution'
import {
  releaseStructuredReservationByUser,
  type StructuredReservationReleaseDeps
} from './structured-agent-session-user-reservation-release'

const NOW = 1_800_000_000_000
const SESSION = 'session-user-release'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function openStore(): Promise<AgentSessionRecordStore> {
  const root = await mkdtemp(join(tmpdir(), 'orca-user-release-'))
  roots.push(root)
  return AgentSessionRecordStore.open({ directory: root, hostId: 'local' })
}

async function latchedReservation(options: { withProcess?: boolean } = {}) {
  const store = await openStore()
  const reserved = await store.reserveOwner({
    sessionId: SESSION,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'folder'
    },
    provider: 'claude',
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/tmp/claude' },
    runtimeKind: 'native',
    expectedFence: null,
    spawnToken: 'spawn-user-release',
    claimKeyId: 'key-1',
    handoffOperationId: null,
    probe: { outcome: 'reservation-unused' },
    operation: { callerKey: 'test', operationId: `${NOW}-${'0'.repeat(32)}`, fingerprint: 'c' },
    now: NOW
  })
  const fence = reserved.record.lease.runtimeFence
  if (options.withProcess) {
    await store.commitProcessIdentity({
      sessionId: SESSION,
      fence,
      process: {
        hostId: 'local',
        pid: 4242,
        processStartTimeMs: NOW,
        spawnToken: 'spawn-user-release'
      },
      now: NOW
    })
  }
  await store.transitionHandoff(SESSION, (record) => ({
    ...record,
    lease: { ...record.lease, handoffStage: 'manual-recovery' }
  }))
  return { store, fence }
}

function releaseDeps(store: AgentSessionRecordStore) {
  const probe = createStructuredAgentSessionOwnerProbe('local')
  const resolveRecovery = vi.fn((sessionId: string) =>
    resolveStructuredSessionRecovery({ store, probeRecord: probe, now: () => NOW + 1 }, sessionId)
  )
  const deps = {
    store,
    now: () => NOW + 1,
    serialize: <T>(_sessionId: string, task: () => Promise<T>) => task(),
    resolveRecovery,
    setStatus: vi.fn(),
    resumeHeld: vi.fn(async () => undefined)
  } satisfies StructuredReservationReleaseDeps
  return deps
}

describe('user release of an ownerless reservation', () => {
  it('advertises the release fence only for an ownerless latched reservation', async () => {
    const ownerless = await latchedReservation()
    expect(idleStructuredHandoffStatus(ownerless.store.getRecord(SESSION)!).error).toMatchObject({
      releaseFence: ownerless.fence
    })

    const owned = await latchedReservation({ withProcess: true })
    expect(idleStructuredHandoffStatus(owned.store.getRecord(SESSION)!).error?.releaseFence).toBe(
      undefined
    )
  })

  it('frees the reservation through the eviction path and resumes the held chat', async () => {
    const { store, fence } = await latchedReservation()
    const deps = releaseDeps(store)

    const result = await releaseStructuredReservationByUser(deps, {
      sessionId: SESSION,
      expectedRuntimeFence: fence
    })

    expect(result).toMatchObject({ ok: true, status: { phase: 'idle', stage: null } })
    expect(store.getRecord(SESSION)?.lease).toMatchObject({
      claimStatus: 'released',
      handoffStage: null,
      ownerProcess: null,
      processlessAt: null,
      runtimeFence: fence + 1
    })
    expect(deps.setStatus).toHaveBeenCalledWith(SESSION, expect.objectContaining({ phase: 'idle' }))
    expect(deps.resumeHeld).toHaveBeenCalledWith(SESSION)
  })

  it('refuses when the lease records an owner process, leaving it untouched', async () => {
    const { store, fence } = await latchedReservation({ withProcess: true })
    const before = store.getRecord(SESSION)
    const deps = releaseDeps(store)

    const result = await releaseStructuredReservationByUser(deps, {
      sessionId: SESSION,
      expectedRuntimeFence: fence
    })

    expect(result).toMatchObject({ ok: false, refusal: { code: 'agent_session_conflict' } })
    expect(store.getRecord(SESSION)).toEqual(before)
    expect(deps.resolveRecovery).not.toHaveBeenCalled()
    expect(deps.resumeHeld).not.toHaveBeenCalled()
  })

  it('refuses a stale fence with the current one', async () => {
    const { store, fence } = await latchedReservation()

    const result = await releaseStructuredReservationByUser(releaseDeps(store), {
      sessionId: SESSION,
      expectedRuntimeFence: fence + 5
    })

    expect(result).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_checkpoint_stale', currentFence: fence }
    })
    expect(store.getRecord(SESSION)?.lease.processlessAt ?? null).toBeNull()
  })

  it('refuses a reservation that is not latched in recovery', async () => {
    const { store, fence } = await latchedReservation()
    await store.transitionHandoff(SESSION, (record) => ({
      ...record,
      lease: { ...record.lease, handoffStage: null }
    }))

    const result = await releaseStructuredReservationByUser(releaseDeps(store), {
      sessionId: SESSION,
      expectedRuntimeFence: fence
    })

    expect(result).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_conflict' }
    })
  })

  it('still reports the release when resuming the chat fails', async () => {
    const { store, fence } = await latchedReservation()
    const deps = releaseDeps(store)
    deps.resumeHeld.mockRejectedValueOnce(new Error('resume failed'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await releaseStructuredReservationByUser(deps, {
      sessionId: SESSION,
      expectedRuntimeFence: fence
    })

    expect(result.ok).toBe(true)
    warn.mockRestore()
  })
})
