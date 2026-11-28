import { randomUUID } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import { lstat, mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { removeTree } from '../../../../shared/file-write/windows-transient-lock-removal'
import { isSafeOwnedDirectory } from '../../../../shared/secure-storage/owned-private-directory'
import { ensureOwnedTempStagingRoot } from '../../../filesystem/owned-temp-staging-root'
import { sanitizeLocalDownloadFilename } from '../downloads/local-download-filename'
import { resolveContainedDragOutPath } from './drag-out-cache-paths'
import {
  DRAG_OUT_MAX_ENTRY_BYTES,
  type DragOutBeginResult,
  type DragOutEntryKey
} from '../../../../shared/file-drag-out/drag-out-contract'

export const DRAG_OUT_MAX_TOTAL_BYTES = 512 * 1024 * 1024
export const DRAG_OUT_MAX_IDLE_MS = 30 * 60 * 1000

type DragOutEntry = {
  id: string
  key: string
  dir: string
  filePath: string
  size: number
  written: number
  state: 'writing' | 'complete'
  opening: Promise<FileHandle> | null
  lastUsedMs: number
  /** The sender that writes the entry. */
  ownerId: number
  /** Senders that began this version and may drag it; reuse across windows adds them. */
  dragOwnerIds: Set<number>
}

type DragOutCacheOptions = {
  /** Per-product, per-user root under the OS temp dir; each run owns one session dir in it. */
  cacheRoot: string
  sessionId: string
  now?: () => number
  maxIdleMs?: number
  maxTotalBytes?: number
  maxEntryBytes?: number
}

function serializeKey(key: DragOutEntryKey): string {
  return JSON.stringify([key.environmentId, key.worktreeId, key.relativePath, key.size, key.mtime])
}

function validateKey(key: DragOutEntryKey, maxEntryBytes: number): void {
  for (const field of ['environmentId', 'worktreeId', 'relativePath'] as const) {
    if (typeof key?.[field] !== 'string' || key[field].trim() === '') {
      throw new Error(`${field} is required`)
    }
  }
  if (!Number.isSafeInteger(key.size) || key.size < 0 || key.size > maxEntryBytes) {
    throw new Error('Drag-out file size is out of range')
  }
  if (typeof key.mtime !== 'number' || !Number.isFinite(key.mtime)) {
    throw new Error('mtime is required')
  }
}

export class DragOutCache {
  readonly cacheRoot: string
  readonly sessionId: string
  readonly sessionDir: string
  private readonly entries = new Map<string, DragOutEntry>()
  private readonly entryIdByKey = new Map<string, string>()
  private activeEntryId: string | null = null
  private sessionReady: Promise<void> | null = null
  private readonly now: () => number
  private readonly maxIdleMs: number
  private readonly maxTotalBytes: number
  private readonly maxEntryBytes: number

  constructor(options: DragOutCacheOptions) {
    this.cacheRoot = options.cacheRoot
    this.sessionId = options.sessionId
    this.sessionDir = join(options.cacheRoot, options.sessionId)
    this.now = options.now ?? Date.now
    this.maxIdleMs = options.maxIdleMs ?? DRAG_OUT_MAX_IDLE_MS
    this.maxTotalBytes = options.maxTotalBytes ?? DRAG_OUT_MAX_TOTAL_BYTES
    this.maxEntryBytes = options.maxEntryBytes ?? DRAG_OUT_MAX_ENTRY_BYTES
  }

  /** Reuses a live entry for the same file version, else reserves space and opens a new one. */
  async begin(key: DragOutEntryKey, name: string, ownerId: number): Promise<DragOutBeginResult> {
    validateKey(key, this.maxEntryBytes)
    const serialized = serializeKey(key)
    const existingId = this.entryIdByKey.get(serialized)
    const existing = existingId ? this.entries.get(existingId) : undefined
    if (existing) {
      existing.lastUsedMs = this.now()
      existing.dragOwnerIds.add(ownerId)
      return { status: existing.state, entryId: existing.id }
    }
    if (!(await this.evictFor(key.size))) {
      return { status: 'rejected' }
    }
    // Re-check: another begin for the same key may have run while eviction awaited.
    const racedId = this.entryIdByKey.get(serialized)
    const raced = racedId ? this.entries.get(racedId) : undefined
    if (raced) {
      raced.dragOwnerIds.add(ownerId)
      return { status: raced.state, entryId: raced.id }
    }
    const id = randomUUID()
    const dir = join(this.sessionDir, id)
    const entry: DragOutEntry = {
      id,
      key: serialized,
      dir,
      filePath: join(dir, sanitizeLocalDownloadFilename(name)),
      size: key.size,
      written: 0,
      state: 'writing',
      opening: null,
      lastUsedMs: this.now(),
      ownerId,
      dragOwnerIds: new Set([ownerId])
    }
    entry.opening = this.openEntryFile(entry)
    this.entries.set(id, entry)
    this.entryIdByKey.set(serialized, id)
    try {
      await entry.opening
    } catch (error) {
      await this.remove(entry)
      throw error
    }
    return { status: 'started', entryId: id }
  }

  async append(entryId: string, ownerId: number, bytes: Buffer): Promise<void> {
    const entry = this.requireWriting(entryId, ownerId)
    if (entry.written + bytes.length > entry.size) {
      await this.remove(entry)
      throw new Error('Drag-out file grew past its listed size')
    }
    const handle = await entry.opening!
    await handle.write(bytes)
    entry.written += bytes.length
    entry.lastUsedMs = this.now()
  }

  async finish(entryId: string, ownerId: number): Promise<void> {
    const entry = this.requireWriting(entryId, ownerId)
    const handle = await entry.opening!
    await handle.close()
    entry.opening = null
    if (entry.written !== entry.size) {
      await this.remove(entry)
      throw new Error('Drag-out file size changed while it was read')
    }
    entry.state = 'complete'
    entry.lastUsedMs = this.now()
  }

  async cancel(entryId: string, ownerId: number): Promise<void> {
    const entry = this.entries.get(entryId)
    if (entry?.state === 'writing' && entry.ownerId === ownerId) {
      await this.remove(entry)
    }
  }

  /** A renderer that went away cannot finish its writes. */
  async cancelOwner(ownerId: number): Promise<void> {
    const owned = [...this.entries.values()].filter(
      (entry) => entry.ownerId === ownerId && entry.state === 'writing'
    )
    await Promise.all(owned.map((entry) => this.remove(entry)))
  }

  /** The cached file for an OS drag, checked to resolve inside the cache root; marks it active. */
  async resolveDragFile(entryId: string, ownerId: number): Promise<string> {
    const entry = this.entries.get(entryId)
    if (!entry || !entry.dragOwnerIds.has(ownerId)) {
      throw new Error('Drag-out entry not found')
    }
    if (entry.state !== 'complete') {
      throw new Error('Drag-out file is not ready')
    }
    const resolved = await resolveContainedDragOutPath(this.cacheRoot, entry.filePath)
    entry.lastUsedMs = this.now()
    this.activeEntryId = entry.id
    return resolved
  }

  totalBytes(): number {
    let total = 0
    for (const entry of this.entries.values()) {
      total += entry.size
    }
    return total
  }

  hasEntry(entryId: string): boolean {
    return this.entries.has(entryId)
  }

  /** Best effort at quit; the next start sweeps whatever is left. */
  async dispose(): Promise<void> {
    const entries = [...this.entries.values()]
    this.entries.clear()
    this.entryIdByKey.clear()
    await Promise.all(
      entries.map(async (entry) => {
        await entry.opening?.then((handle) => handle.close()).catch(() => undefined)
      })
    )
    await removeTree(this.sessionDir).catch(() => undefined)
  }

  private requireWriting(entryId: string, ownerId: number): DragOutEntry {
    const entry = this.entries.get(entryId)
    if (!entry || entry.state !== 'writing' || !entry.opening || entry.ownerId !== ownerId) {
      throw new Error('Drag-out entry not found')
    }
    return entry
  }

  private isEvictable(entry: DragOutEntry): boolean {
    return entry.state === 'complete' && entry.id !== this.activeEntryId
  }

  /** Drops idle entries, then LRU entries until `incomingBytes` fits; false when it cannot fit. */
  private async evictFor(incomingBytes: number): Promise<boolean> {
    const nowMs = this.now()
    const victims: DragOutEntry[] = []
    let total = 0
    const candidates: DragOutEntry[] = []
    for (const entry of this.entries.values()) {
      if (this.isEvictable(entry) && nowMs - entry.lastUsedMs > this.maxIdleMs) {
        victims.push(entry)
        continue
      }
      total += entry.size
      if (this.isEvictable(entry)) {
        candidates.push(entry)
      }
    }
    candidates.sort((a, b) => a.lastUsedMs - b.lastUsedMs)
    while (total + incomingBytes > this.maxTotalBytes && candidates.length > 0) {
      const victim = candidates.shift()!
      victims.push(victim)
      total -= victim.size
    }
    await Promise.all(victims.map((entry) => this.remove(entry)))
    return total + incomingBytes <= this.maxTotalBytes
  }

  private async ensureSessionDir(): Promise<void> {
    this.sessionReady ??= (async () => {
      if (!(await ensureOwnedTempStagingRoot(this.cacheRoot))) {
        throw new Error('Drag-out cache root is unsafe')
      }
      await mkdir(this.sessionDir, { recursive: true, mode: 0o700 })
      if (!isSafeOwnedDirectory(await lstat(this.sessionDir))) {
        throw new Error('Drag-out session directory is unsafe')
      }
    })().catch((error: unknown) => {
      this.sessionReady = null
      throw error
    })
    return this.sessionReady
  }

  private async openEntryFile(entry: DragOutEntry): Promise<FileHandle> {
    await this.ensureSessionDir()
    await mkdir(entry.dir, { mode: 0o700 })
    return open(entry.filePath, 'wx', 0o600)
  }

  private async remove(entry: DragOutEntry): Promise<void> {
    if (this.entries.get(entry.id) !== entry) {
      return
    }
    this.entries.delete(entry.id)
    if (this.entryIdByKey.get(entry.key) === entry.id) {
      this.entryIdByKey.delete(entry.key)
    }
    if (this.activeEntryId === entry.id) {
      this.activeEntryId = null
    }
    const opening = entry.opening
    entry.opening = null
    await opening?.then((handle) => handle.close()).catch(() => undefined)
    await removeTree(entry.dir).catch(() => undefined)
  }
}
