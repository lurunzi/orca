import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { walkLocalFileTree } from './file-tree-walk'

describe('walkLocalFileTree', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'orca-tree-walk-'))
    await mkdir(join(base, 'root', 'sub'), { recursive: true })
    await mkdir(join(base, 'secret'))
    await writeFile(join(base, 'secret', 'token'), 'do-not-list')
    await writeFile(join(base, 'root', 'a.txt'), 'abc')
    await writeFile(join(base, 'root', 'sub', 'b.bin'), Buffer.alloc(5))
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('lists parents before children and never follows a link out of the folder', async () => {
    let linked = true
    try {
      await symlink(join(base, 'secret'), join(base, 'root', 'link'), 'junction')
    } catch {
      // Unprivileged Windows without junction support: the order invariant still runs.
      linked = false
    }
    const result = await walkLocalFileTree(join(base, 'root'))
    expect(result.entries).toEqual([
      { relativePath: 'a.txt', isDirectory: false, size: 3 },
      { relativePath: 'sub', isDirectory: true, size: 0 },
      { relativePath: 'sub/b.bin', isDirectory: false, size: 5 }
    ])
    expect(result.totalBytes).toBe(8)
    expect(result.skipped).toEqual(linked ? [{ relativePath: 'link', reason: 'symlink' }] : [])
  })

  it('refuses a folder over the entry cap', async () => {
    await expect(walkLocalFileTree(join(base, 'root'), { maxEntries: 2 })).rejects.toThrow(
      'folder_too_large'
    )
  })
})
