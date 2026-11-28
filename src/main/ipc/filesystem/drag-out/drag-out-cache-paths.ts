import { randomUUID } from 'node:crypto'
import type { Dir } from 'node:fs'
import { lstat, opendir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { removeTree } from '../../../../shared/file-write/windows-transient-lock-removal'

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const SESSION_DIRECTORY_PATTERN = new RegExp(`^(\\d{1,10})-${UUID_PATTERN}$`, 'i')

export function createDragOutSessionId(pid = process.pid): string {
  return `${pid}-${randomUUID()}`
}

/** True when `candidate` is `root` itself or below it, after both are resolved. */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** fs/promises realpath is the native one: resolves symlinks and Windows 8.3 names, so a link inside the cache cannot hand out a path outside it. */
export async function resolveContainedDragOutPath(
  cacheRoot: string,
  candidate: string
): Promise<string> {
  if (!isAbsolute(candidate)) {
    throw new Error('Drag-out path must be absolute')
  }
  const [realRoot, realCandidate] = await Promise.all([realpath(cacheRoot), realpath(candidate)])
  if (realCandidate === realRoot || !isPathInsideRoot(realRoot, realCandidate)) {
    throw new Error('Drag-out path is outside the drag-out cache')
  }
  const stats = await lstat(realCandidate)
  if (!stats.isFile()) {
    throw new Error('Drag-out path is not a regular file')
  }
  return realCandidate
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

/** Removes session dirs left by earlier runs; a dir whose process still runs belongs to a live instance. */
export async function sweepEarlierDragOutSessions(
  cacheRoot: string,
  currentSessionId: string,
  isAlive: (pid: number) => boolean = isProcessAlive
): Promise<void> {
  let dir: Dir
  try {
    dir = await opendir(cacheRoot)
  } catch {
    return
  }
  const stale: string[] = []
  try {
    for await (const entry of dir) {
      const match = SESSION_DIRECTORY_PATTERN.exec(entry.name)
      if (!entry.isDirectory() || !match || entry.name === currentSessionId) {
        continue
      }
      const pid = Number(match[1])
      if (pid !== process.pid && isAlive(pid)) {
        continue
      }
      stale.push(join(cacheRoot, entry.name))
    }
  } catch {
    // A partial listing still lets the next start finish the sweep.
  }
  await Promise.all(stale.map((path) => removeTree(path).catch(() => undefined)))
}
