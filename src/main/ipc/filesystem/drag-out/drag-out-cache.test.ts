import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DragOutCache } from './drag-out-cache'
import { resolveContainedDragOutPath, sweepEarlierDragOutSessions } from './drag-out-cache-paths'

const SESSION = '4242-00000000-0000-4000-8000-000000000001'
let tempRoot: string
let cacheRoot: string
let nowMs: number

function key(relativePath: string, size: number) {
  return { environmentId: 'env', worktreeId: 'wt', relativePath, size, mtime: 1 }
}

async function cacheFile(cache: DragOutCache, relativePath: string, bytes: Buffer) {
  const begin = await cache.begin(key(relativePath, bytes.length), basename(relativePath), 1)
  if (begin.status !== 'started') {
    throw new Error(`unexpected ${begin.status}`)
  }
  await cache.append(begin.entryId, 1, bytes)
  await cache.finish(begin.entryId, 1)
  return begin.entryId
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'drag-out-cache-test-'))
  cacheRoot = join(tempRoot, 'orca-drag-out')
  nowMs = 1_000_000
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('DragOutCache', () => {
  it('writes each entry in its own directory inside the cache and reuses the same version', async () => {
    const cache = new DragOutCache({ cacheRoot, sessionId: SESSION, now: () => nowMs })
    const first = await cacheFile(cache, 'docs/a:b.txt', Buffer.from('hello'))
    const second = await cacheFile(cache, 'docs/c.txt', Buffer.from('world'))

    const firstPath = await cache.resolveDragFile(first, 1)
    const secondPath = await cache.resolveDragFile(second, 1)
    expect(basename(firstPath)).toBe('a_b.txt')
    expect(await readFile(firstPath, 'utf8')).toBe('hello')
    expect(dirname(firstPath)).not.toBe(dirname(secondPath))
    expect(dirname(dirname(firstPath))).toBe(await realpath(join(cacheRoot, SESSION)))
    expect(await cache.begin(key('docs/a:b.txt', 5), 'a:b.txt', 1)).toEqual({
      status: 'complete',
      entryId: first
    })
  })

  it('discards an entry whose bytes do not match its listed size', async () => {
    const cache = new DragOutCache({ cacheRoot, sessionId: SESSION })
    const begin = await cache.begin(key('a.txt', 3), 'a.txt', 1)
    if (begin.status !== 'started') {
      throw new Error('not started')
    }
    await expect(cache.append(begin.entryId, 1, Buffer.from('four'))).rejects.toThrow()
    expect(cache.hasEntry(begin.entryId)).toBe(false)
    await expect(cache.resolveDragFile(begin.entryId, 1)).rejects.toThrow()
  })

  it('evicts idle entries, then least recently used ones, but never the active drag or a write', async () => {
    const cache = new DragOutCache({
      cacheRoot,
      sessionId: SESSION,
      now: () => nowMs,
      maxTotalBytes: 30,
      maxIdleMs: 1_000
    })
    const idle = await cacheFile(cache, 'idle.bin', Buffer.alloc(10))
    nowMs += 2_000
    const active = await cacheFile(cache, 'active.bin', Buffer.alloc(10))
    await cache.resolveDragFile(active, 1)
    nowMs += 1
    const lru = await cacheFile(cache, 'lru.bin', Buffer.alloc(10))
    expect(cache.hasEntry(idle)).toBe(false)

    nowMs += 1
    const writing = await cache.begin(key('writing.bin', 10), 'writing.bin', 1)
    expect(writing.status).toBe('started')
    nowMs += 1
    const next = await cacheFile(cache, 'next.bin', Buffer.alloc(10))

    expect(cache.hasEntry(lru)).toBe(false)
    expect(cache.hasEntry(active)).toBe(true)
    expect(writing.status === 'started' && cache.hasEntry(writing.entryId)).toBe(true)
    expect(cache.hasEntry(next)).toBe(true)
    expect(cache.totalBytes()).toBeLessThanOrEqual(30)
    // Only the active drag and the write remain once `next` goes, and 25 more bytes still do not fit.
    expect(await cache.begin(key('full.bin', 25), 'full.bin', 1)).toEqual({ status: 'rejected' })
    expect(cache.hasEntry(active)).toBe(true)
    expect(writing.status === 'started' && cache.hasEntry(writing.entryId)).toBe(true)
    // The unfinished write still holds its file open; Node 24 throws when GC has to close it.
    await cache.dispose()
  })

  it('binds writes to the writing sender and drags to senders that began the entry', async () => {
    const cache = new DragOutCache({ cacheRoot, sessionId: SESSION })
    const begin = await cache.begin(key('owned.txt', 2), 'owned.txt', 1)
    if (begin.status !== 'started') {
      throw new Error('not started')
    }
    await expect(cache.append(begin.entryId, 2, Buffer.from('xx'))).rejects.toThrow(
      'Drag-out entry not found'
    )
    await expect(cache.finish(begin.entryId, 2)).rejects.toThrow('Drag-out entry not found')
    await cache.cancel(begin.entryId, 2)
    expect(cache.hasEntry(begin.entryId)).toBe(true)
    await cache.append(begin.entryId, 1, Buffer.from('ok'))
    await cache.finish(begin.entryId, 1)

    await expect(cache.resolveDragFile(begin.entryId, 2)).rejects.toThrow(
      'Drag-out entry not found'
    )
    expect(await cache.begin(key('owned.txt', 2), 'owned.txt', 2)).toEqual({
      status: 'complete',
      entryId: begin.entryId
    })
    expect(await readFile(await cache.resolveDragFile(begin.entryId, 2), 'utf8')).toBe('ok')
  })

  it('removes the session directory on dispose', async () => {
    const cache = new DragOutCache({ cacheRoot, sessionId: SESSION })
    await cacheFile(cache, 'a.txt', Buffer.from('a'))
    await cache.dispose()
    expect(existsSync(join(cacheRoot, SESSION))).toBe(false)
  })
})

describe('resolveContainedDragOutPath', () => {
  it('rejects paths outside the cache, traversal, and links that lead out of it', async () => {
    const outside = join(tempRoot, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await mkdir(cacheRoot)
    await writeFile(join(cacheRoot, 'inside.txt'), 'ok')
    // A junction needs no privilege on Windows and is a directory symlink elsewhere.
    await symlink(outside, join(cacheRoot, 'link'), 'junction')

    await expect(
      resolveContainedDragOutPath(cacheRoot, join(cacheRoot, 'inside.txt'))
    ).resolves.toBe(await realpath(join(cacheRoot, 'inside.txt')))
    await expect(
      resolveContainedDragOutPath(cacheRoot, join(outside, 'secret.txt'))
    ).rejects.toThrow()
    await expect(
      resolveContainedDragOutPath(cacheRoot, join(cacheRoot, '..', 'outside', 'secret.txt'))
    ).rejects.toThrow()
    await expect(
      resolveContainedDragOutPath(cacheRoot, join(cacheRoot, 'link', 'secret.txt'))
    ).rejects.toThrow()
    await expect(resolveContainedDragOutPath(cacheRoot, cacheRoot)).rejects.toThrow()
    await expect(resolveContainedDragOutPath(cacheRoot, 'inside.txt')).rejects.toThrow()
  })
})

describe('sweepEarlierDragOutSessions', () => {
  it('removes dead earlier sessions and keeps the current and live ones', async () => {
    const dead = '111-00000000-0000-4000-8000-000000000002'
    const live = '222-00000000-0000-4000-8000-000000000003'
    for (const name of [SESSION, dead, live, 'unrelated']) {
      await mkdir(join(cacheRoot, name), { recursive: true })
    }
    await sweepEarlierDragOutSessions(cacheRoot, SESSION, (pid) => pid === 222)
    expect(existsSync(join(cacheRoot, dead))).toBe(false)
    expect(existsSync(join(cacheRoot, live))).toBe(true)
    expect(existsSync(join(cacheRoot, SESSION))).toBe(true)
    expect(existsSync(join(cacheRoot, 'unrelated'))).toBe(true)
  })
})
