import { once } from 'node:events'
import { createConnection, createServer } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runWithActiveRpcCaller } from '../runtime/rpc/callers/active-call'
import { openPairedClaudeSession } from './paired-claude-session'
import {
  closeRevokedSubscriptionDevice,
  retainSubscriptionSession,
  setSubscriptionDeviceLookup,
  watchSubscriptionDevices
} from './paired-subscription-leases'
import { assertSubscriptionSessionCaller, subscriptionDevice } from './paired-subscription-owner'

const alice = { kind: 'paired-device', deviceId: 'test-device-a' } as const
const bob = { kind: 'paired-device', deviceId: 'test-device-b' } as const
const session = {
  sessionId: 'test-session',
  providerSessionId: '2010a1b4-141a-4bb7-8b86-916dc583b0be',
  configDir: '/home/node/.claude',
  resume: false
}
afterEach(() => {
  vi.useRealTimers()
  setSubscriptionDeviceLookup(() => false)
})

describe('paired subscription relay', () => {
  it('derives the subject exclusively from a paired RPC, including after an await', async () => {
    setSubscriptionDeviceLookup((id) => id === alice.deviceId)
    await runWithActiveRpcCaller(alice, async () => {
      await Promise.resolve()
      expect(subscriptionDevice()).toBe(alice.deviceId)
    })
    for (const caller of [
      undefined,
      { kind: 'local-cli' } as const,
      { kind: 'desktop' } as const,
      bob
    ]) {
      expect(() => runWithActiveRpcCaller(caller, () => subscriptionDevice())).toThrow()
    }
  })
  it('a second subject closes a writer, which remains denied until exit is observed', () => {
    setSubscriptionDeviceLookup(() => true)
    const stop = vi.fn()
    const release = retainSubscriptionSession(session.sessionId, alice.deviceId, stop)
    try {
      expect(() => assertSubscriptionSessionCaller(session.sessionId, alice)).not.toThrow()
      expect(() => assertSubscriptionSessionCaller(session.sessionId, bob)).toThrow()
      expect(() => assertSubscriptionSessionCaller(session.sessionId, alice)).toThrow()
      expect(() => retainSubscriptionSession(session.sessionId, bob.deviceId, stop)).toThrow()
      expect(stop).toHaveBeenCalledTimes(1)
    } finally {
      release()
    }
  })
  it('immediately terminates only the device just removed by the runtime', () => {
    setSubscriptionDeviceLookup(() => true)
    const stop = vi.fn()
    const release = retainSubscriptionSession(session.sessionId, alice.deviceId, stop)
    try {
      closeRevokedSubscriptionDevice(bob.deviceId)
      expect(stop).not.toHaveBeenCalled()
      closeRevokedSubscriptionDevice(alice.deviceId)
      expect(stop).toHaveBeenCalledOnce()
      expect(() => assertSubscriptionSessionCaller(session.sessionId, alice)).toThrow()
    } finally {
      release()
    }
  })
  it('closes an idle connection when its device is revoked outside this process', () => {
    let changed: (() => void) | undefined
    let current = true
    setSubscriptionDeviceLookup(() => current)
    watchSubscriptionDevices((notify) => {
      changed = notify
      return () => {}
    })
    const stop = vi.fn()
    const release = retainSubscriptionSession(session.sessionId, alice.deviceId, stop)
    try {
      current = false
      changed?.()
      expect(stop).toHaveBeenCalledOnce()
      expect(() => assertSubscriptionSessionCaller(session.sessionId, alice)).toThrow()
    } finally {
      release()
    }
  })
  it('closes the active lease and refuses new admission when watching fails', () => {
    let fail: (() => void) | undefined
    setSubscriptionDeviceLookup(() => true)
    watchSubscriptionDevices((_changed, failed) => {
      fail = failed
      return () => {}
    })
    const stop = vi.fn()
    const release = retainSubscriptionSession(session.sessionId, alice.deviceId, stop)
    try {
      fail?.()
      expect(stop).toHaveBeenCalledOnce()
      expect(() => subscriptionDevice(alice)).toThrow('Paired subscription registry watcher unavailable')
      expect(() => retainSubscriptionSession('another-session', alice.deviceId, stop)).toThrow()
    } finally {
      release()
    }
  })
  it.each([false, true])(
    'performs the orcad admission before the helper starts (resume=%s)',
    async (resume) => {
      setSubscriptionDeviceLookup((id) => id === alice.deviceId)
      const expected = { ...session, resume }
      const entered = Promise.withResolvers<unknown>()
      const server = createServer((socket) => {
        socket.once('data', (bytes) => {
          entered.resolve(JSON.parse(bytes.toString()))
          socket.write('{"ready":true}\n')
        })
      })
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Missing loopback test listener')
      }
      try {
        const relay = await runWithActiveRpcCaller(alice, () =>
          openPairedClaudeSession(expected, '/home/node/workspace', 'sonnet', () =>
            createConnection(address.port, '127.0.0.1')
          )
        )
        try {
          expect(await entered.promise).toEqual({
            version: 1,
            deviceId: alice.deviceId,
            ...expected,
            cwd: '/home/node/workspace'
          })
          expect(relay.args).not.toContain(alice.deviceId)
          expect(relay.args).not.toContain(expected.sessionId)
          expect(relay.args).toContain(resume ? '--resume' : '--session-id')
          expect(relay.args).toContain('sonnet')
        } finally {
          relay.dispose()
        }
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }
  )
})
