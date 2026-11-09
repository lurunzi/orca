import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCodexAppServerSession, type CodexAppServerSessionRpc } from './codex-app-server-session'
import {
  spawnCodexAppServerProcess,
  type CodexAppServerSpawn
} from './codex-app-server-process-tree-kill'

const originalCodexHome = process.env.CODEX_HOME

afterEach(() => {
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME
  } else {
    process.env.CODEX_HOME = originalCodexHome
  }
})

describe('runCodexAppServerSession environment', () => {
  it('removes inherited variables requested by a default-home invocation', async () => {
    process.env.CODEX_HOME = '/tmp/inherited-managed-home'
    const server = String.raw`
      const readline = require('node:readline')
      readline.createInterface({ input: process.stdin }).on('line', (line) => {
        const message = JSON.parse(line)
        if (typeof message.id !== 'number') return
        const result = message.method === 'env/get'
          ? { codexHome: process.env.CODEX_HOME ?? null, cwd: process.cwd() }
          : {}
        process.stdout.write(JSON.stringify({ id: message.id, result }) + '\n')
      })
    `

    const result = await runCodexAppServerSession(
      {
        command: process.execPath,
        cliPath: null,
        args: ['-e', server],
        cwd: __dirname,
        envToDelete: ['CODEX_HOME'],
        timeoutMs: 5_000
      },
      ({ request }) => request('env/get')
    )

    expect(result).toEqual({ codexHome: null, cwd: __dirname })
  })

  it('keeps the session alive after a large legitimate response', async () => {
    const server = String.raw`
      const readline = require('node:readline')
      readline.createInterface({ input: process.stdin }).on('line', (line) => {
        const message = JSON.parse(line)
        if (typeof message.id !== 'number') return
        const result = message.method === 'test/large'
          ? { data: 'x'.repeat(1024 * 1024 + 1) }
          : { alive: true }
        process.stdout.write(JSON.stringify({ id: message.id, result }) + '\n')
      })
    `

    const result = await runCodexAppServerSession(
      {
        command: process.execPath,
        cliPath: null,
        args: ['-e', server],
        timeoutMs: 5_000
      },
      async ({ request }) => {
        const large = (await request('test/large')) as { data: string }
        const followup = await request('test/followup')
        return { largeBytes: Buffer.byteLength(large.data, 'utf8'), followup }
      }
    )

    expect(result).toEqual({ largeBytes: 1024 * 1024 + 1, followup: { alive: true } })
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function captureSpawn() {
  const spawned = deferred<{
    pid: number | undefined
    written: () => string[]
    exit: Promise<void>
  }>()
  const spawn: CodexAppServerSpawn = (program, args, options) => {
    const child = spawnCodexAppServerProcess(program, args, options)
    if (!child.stdin) {
      throw new Error('expected piped stdin')
    }
    const write = vi.spyOn(child.stdin, 'write')
    spawned.resolve({
      pid: child.pid,
      written: () => write.mock.calls.map(([chunk]) => String(chunk)),
      exit: new Promise<void>((resolve) => child.once('exit', () => resolve()))
    })
    return child
  }
  return { spawn, spawned: spawned.promise }
}

const CONTROLLED_SERVER = String.raw`
  const send = (message) => process.stdout.write(JSON.stringify(message) + '\n')
  require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method === 'initialize') send({ id: message.id, result: {} })
    if (message.method === 'test/exit') process.exit(17)
  })
`

function controlledInvocation(signal?: AbortSignal) {
  return {
    command: process.execPath,
    cliPath: null,
    args: ['-e', CONTROLLED_SERVER],
    timeoutMs: 5_000,
    signal
  }
}

describe('runCodexAppServerSession lifecycle', () => {
  it('handles same-id server requests and notifications during initialize before awaiting its hook', async () => {
    const server = String.raw`
      const send = (message) => process.stdout.write(JSON.stringify(message) + '\n')
      let initializeId, numericReply, stringError, noticeAck
      const events = []
      require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
        const message = JSON.parse(line)
        if (message.method === 'initialize') {
          initializeId = message.id
          send({ id: message.id, method: 'test/numeric', params: { source: 'initialize' } })
          send({ id: '1', method: 'test/string', params: null })
          send({ method: 'test/notice', params: { ready: true } })
          return
        }
        if (message.method === 'initialized') events.push('initialized')
        if (message.method === 'test/hook') {
          events.push('hook')
          send({ id: message.id, result: { events } })
        }
        if (message.method === 'test/hook-complete') events.push('hook_complete')
        if (message.method === 'test/body') {
          events.push('body')
          send({ id: message.id, result: { events } })
        }
        if (message.method === 'test/notice-ack') noticeAck = message.params
        if (message.id === initializeId && !message.method) numericReply = message.result
        if (message.id === '1' && !message.method) stringError = message.error
        if (initializeId !== undefined && numericReply && stringError && noticeAck) {
          send({ id: initializeId, result: { numericReply, stringError, noticeAck } })
          initializeId = undefined
        }
      })
    `
    const result = await runCodexAppServerSession(
      { command: process.execPath, cliPath: null, args: ['-e', server], timeoutMs: 5_000 },
      ({ request }) => request('test/body'),
      undefined,
      {
        onServerRequest: ({ id, method, params }, rpc) => {
          if (method === 'test/numeric') {
            expect(id).toBe(1)
            expect(params).toEqual({ source: 'initialize' })
            rpc.respond(id, { accepted: true })
          } else {
            expect(id).toBe('1')
            rpc.respondWithError(id, -32000, 'declined')
          }
        },
        onNotification: (method, params, rpc) => {
          expect(method).toBe('test/notice')
          rpc.notify('test/notice-ack', params as Record<string, unknown>)
        },
        onInitialized: async (rpc, initialized) => {
          expect(initialized).toEqual({
            numericReply: { accepted: true },
            stringError: { code: -32000, message: 'declined' },
            noticeAck: { ready: true }
          })
          expect(await rpc.request('test/hook')).toEqual({ events: ['initialized', 'hook'] })
          rpc.notify('test/hook-complete')
        }
      }
    )
    expect(result).toEqual({ events: ['initialized', 'hook', 'hook_complete', 'body'] })
  })

  it('reaps a cancelled session without awaiting a hanging hook or writing its late replies', async () => {
    const controller = new AbortController()
    const capture = captureSpawn()
    const entered = deferred<CodexAppServerSessionRpc>()
    const release = deferred<void>()
    const late = deferred<unknown>()
    let bodyRan = false
    const session = runCodexAppServerSession(
      controlledInvocation(controller.signal),
      async () => {
        bodyRan = true
      },
      capture.spawn,
      {
        onInitialized: async (rpc) => {
          rpc.signal.addEventListener('abort', () => rpc.respond('during_abort', { token: 'late' }))
          entered.resolve(rpc)
          await release.promise
          rpc.respond('refresh', { token: 'late' })
          rpc.respondWithError(1, -32000, 'late')
          rpc.notify('test/late')
          late.resolve(await rpc.request('test/late').catch((error: unknown) => error))
        }
      }
    )
    const rejected = expect(session).rejects.toThrow('codex app-server session stopped')
    const rpc = await entered.promise
    const child = await capture.spawned
    expect(rpc.pid).toBe(child.pid)
    const written = child.written()
    controller.abort()
    await rejected
    await child.exit
    expect(rpc.closed).toBe(true)
    expect(rpc.signal.aborted).toBe(true)
    expect(child.written()).toEqual(written)
    release.resolve()
    expect(await late.promise).toBeInstanceOf(Error)
    expect(child.written()).toEqual(written)
    expect(bodyRan).toBe(false)
  })

  it('invalidates a hanging hook on process exit and blocks its continuation', async () => {
    const capture = captureSpawn()
    const entered = deferred<CodexAppServerSessionRpc>()
    const release = deferred<void>()
    const late = deferred<void>()
    let bodyRan = false
    const session = runCodexAppServerSession(
      controlledInvocation(),
      async () => {
        bodyRan = true
      },
      capture.spawn,
      {
        onInitialized: async (rpc) => {
          entered.resolve(rpc)
          rpc.notify('test/exit')
          await release.promise
          rpc.respond('refresh', { token: 'late' })
          rpc.notify('test/late')
          late.resolve()
        }
      }
    )
    const rejected = expect(session).rejects.toThrow('codex app-server exited before completing')
    const rpc = await entered.promise
    const child = await capture.spawned
    await rejected
    await child.exit
    expect(rpc.closed).toBe(true)
    expect(rpc.signal.aborted).toBe(true)
    const written = child.written()
    release.resolve()
    await late.promise
    expect(child.written()).toEqual(written)
    expect(bodyRan).toBe(false)
  })
})
