import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type * as Fs from 'node:fs'
import type * as FsPromises from 'node:fs/promises'

// Coarse-timestamp kernels give two same-size writes within one tick the same stat signature.
const NOW_MS = Date.UTC(2025, 0, 1)
const tick = vi.hoisted(() => ({ ns: 0n }))
function coarse(real: Fs.BigIntStats): Fs.BigIntStats {
  return { ...real, mtimeNs: tick.ns, ctimeNs: tick.ns }
}
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof Fs>()
  return { ...fs, statSync: (path: string) => coarse(fs.statSync(path, { bigint: true })) }
})
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof FsPromises>()
  return {
    ...fs,
    stat: async (path: string) => coarse(await fs.stat(path, { bigint: true }))
  }
})

import { readClaudeFolderLogin, readClaudeFolderLoginAsync } from './claude-account-folder'

let root = ''
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW_MS })
  root = mkdtempSync(join(tmpdir(), 'claude-account-folder-coarse-'))
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

function writeLogin(state: string, email: string): void {
  writeFileSync(state, JSON.stringify({ oauthAccount: { emailAddress: email } }))
}

it.each(['sync', 'async'] as const)(
  'rereads a same-size rewrite within the current timestamp tick (%s)',
  async (mode) => {
    tick.ns = BigInt(NOW_MS) * 1_000_000n
    const state = join(root, '.claude.json')
    writeLogin(state, 'a@example.test')
    expect(readClaudeFolderLogin(state)?.email).toBe('a@example.test')
    writeLogin(state, 'b@example.test')
    const next =
      mode === 'sync' ? readClaudeFolderLogin(state) : await readClaudeFolderLoginAsync(state)
    expect(next?.email).toBe('b@example.test')
  }
)

it('trusts the signature once the timestamps are older than the racy margin', async () => {
  tick.ns = BigInt(NOW_MS - 60_000) * 1_000_000n
  const state = join(root, '.claude.json')
  writeLogin(state, 'a@example.test')
  expect(readClaudeFolderLogin(state)?.email).toBe('a@example.test')
  // Unchanged signature: served from cache, so the rewrite is deliberately not observed.
  writeLogin(state, 'b@example.test')
  expect((await readClaudeFolderLoginAsync(state))?.email).toBe('a@example.test')
})
