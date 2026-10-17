import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  flushSessionParseCachePersist,
  initSessionParseCachePersistence,
  resetSessionParseCachePersistenceForTests
} from './session-parse-cache-persistence'
import {
  createSessionParseStats,
  parseAgentSessionFileCached,
  resetSessionParseCacheForTests
} from './session-scanner-parse-cache'
import { getSessionParseCacheEntry } from './session-parse-cache-store'
import type { SessionFileCandidate } from './session-scanner-types'

let root: string | undefined

afterEach(async () => {
  resetSessionParseCacheForTests()
  resetSessionParseCachePersistenceForTests()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})

it('replaces a persisted Cursor envelope title even when its transcript has not changed', async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-cursor-title-upgrade-'))
  const path = join(root, 'chat.jsonl')
  await writeFile(
    path,
    `${JSON.stringify({
      role: 'user',
      message: {
        content:
          '<timestamp>Sunday, Oct 11, 2026</timestamp>\n<user_query>Fix the login bug</user_query>'
      }
    })}\n`
  )
  const fileStat = await stat(path)
  const candidate: SessionFileCandidate = {
    agent: 'cursor',
    codexHome: null,
    file: {
      path,
      mtimeMs: fileStat.mtimeMs,
      modifiedAt: fileStat.mtime.toISOString(),
      sizeBytes: fileStat.size,
      sidecar: 'none'
    }
  }
  await parseAgentSessionFileCached(candidate, process.platform)
  const { resume: _resume, foldSession: _fold, ...entry } = getSessionParseCacheEntry(path)!
  const entries = [
    [
      path,
      {
        ...entry,
        session: entry.session && { ...entry.session, title: '<timestamp>Sunday, Oct 11, 2026...' }
      }
    ]
  ]
  const cacheFile = join(root, 'cache.json')
  await writeFile(cacheFile, JSON.stringify({ schemaVersion: 4, appVersion: 'pre-fix', entries }))
  resetSessionParseCacheForTests()
  initSessionParseCachePersistence({ filePath: cacheFile, appVersion: 'fixed' })

  const stats = createSessionParseStats()
  const session = await parseAgentSessionFileCached(candidate, process.platform, stats)
  expect(session?.title).toBe('Fix the login bug')
  expect(stats.fullParses).toBe(1)
  expect(stats.reused).toBe(0)

  await flushSessionParseCachePersist()
  resetSessionParseCacheForTests()
  resetSessionParseCachePersistenceForTests()
  initSessionParseCachePersistence({ filePath: cacheFile, appVersion: 'next-release' })
  const reusedStats = createSessionParseStats()
  const reused = await parseAgentSessionFileCached(candidate, process.platform, reusedStats)
  expect(reused?.title).toBe('Fix the login bug')
  expect(reusedStats.reused).toBe(1)
  expect(reusedStats.fullParses).toBe(0)
})
