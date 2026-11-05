import { expect, it, vi } from 'vitest'
import { DashboardAgentRestartCode } from '../../dashboard-accounts/dashboard-agent-restart-protocol'
import { DashboardToolProvider } from '../../dashboard-accounts/dashboard-allocation-protocol'
import { fixture } from './structured-agent-session-claude-stop-contract-test-fixture'
import { HOST_TEST_SESSION as SESSION } from './structured-agent-session-host-test-data'

it('releases a strict credential close after the original Claude connection reports its late root exit', async () => {
  const { host, store, claude } = fixture
  const child = host.collaboratorsForTests().sessions.get(SESSION)?.child
  const process = store.requireWritableRecord(SESSION).lease.ownerProcess
  if (!child?.generation || !process) {
    throw new Error('expected acquired Claude fixture')
  }
  const input = {
    provider: DashboardToolProvider.ClaudeCode,
    session_id: SESSION,
    fence: child.fence,
    acquisition_generation: child.generation,
    confirm_interrupt: true,
    process: {
      hostId: process.hostId,
      pid: process.pid,
      processStartTimeMs: process.processStartTimeMs,
      spawnToken: process.spawnToken
    }
  }
  const connection = claude.connections[0]!
  connection.exitVerdict = { root: 'unverifiable', tree: 'unverifiable', killDelivered: true }
  const close = vi.spyOn(connection, 'close').mockResolvedValue(false)
  await expect(host.restartAgentForCredentials(input)).rejects.toMatchObject({
    code: DashboardAgentRestartCode.ExitUnconfirmed
  })
  await expect(host.close(SESSION, 'user-close')).rejects.toThrow()
  expect(close).toHaveBeenCalledOnce()
  expect(host.collaboratorsForTests().sessions.get(SESSION)?.child).toBe(child)
  expect(store.requireWritableRecord(SESSION).lease.claimStatus).toBe('live')
  connection.closed = true
  connection.exitVerdict = { root: 'exited', tree: 'unverifiable' }
  connection.handlers.onExit?.(new Error('actual root exit'), { expected: true })
  await vi.waitFor(() => {
    expect(host.collaboratorsForTests().sessions.get(SESSION)?.child).toBeNull()
    expect(store.requireWritableRecord(SESSION).lease).toMatchObject({
      claimStatus: 'released',
      ownerProcess: null
    })
  })
  expect(fixture.events.filter((event) => event.type === 'ended')).toEqual([
    expect.objectContaining({
      fence: input.fence,
      acquisitionGeneration: input.acquisition_generation,
      deathEvidenceKind: 'kill-delivered'
    }),
    expect.objectContaining({
      fence: input.fence,
      acquisitionGeneration: input.acquisition_generation,
      reason: 'claude process exited after close'
    })
  ])
  expect(claude.connections).toHaveLength(1)
  expect(connection.sent).toEqual([])
})
