import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  FILE_TREE_LIST_MAX_ENTRIES,
  FILE_TREE_LIST_MAX_TOTAL_BYTES,
  FILE_TREE_LIST_TOO_LARGE_MESSAGE,
  type FileTreeListResult
} from '../../../shared/file-listing/file-tree-listing'

/** Walks a folder without following symlinks; the caller must have authorized `rootPath` itself. */
export async function walkLocalFileTree(
  rootPath: string,
  options: { signal?: AbortSignal; maxEntries?: number; maxTotalBytes?: number } = {}
): Promise<FileTreeListResult> {
  const maxEntries = options.maxEntries ?? FILE_TREE_LIST_MAX_ENTRIES
  const maxTotalBytes = options.maxTotalBytes ?? FILE_TREE_LIST_MAX_TOTAL_BYTES
  const rootStats = await lstat(rootPath)
  if (!rootStats.isDirectory()) {
    throw new Error('not_a_directory')
  }
  const result: FileTreeListResult = { entries: [], skipped: [], totalBytes: 0 }
  // Depth-first with an explicit stack keeps parents ahead of their children.
  const pending: string[] = ['']
  for (let relativeDir = pending.pop(); relativeDir !== undefined; relativeDir = pending.pop()) {
    options.signal?.throwIfAborted()
    const names = (await readdir(join(rootPath, relativeDir))).sort()
    const childDirs: string[] = []
    for (const name of names) {
      const relativePath = relativeDir ? `${relativeDir}/${name}` : name
      const stats = await lstat(join(rootPath, relativePath))
      if (stats.isSymbolicLink()) {
        result.skipped.push({ relativePath, reason: 'symlink' })
        continue
      }
      if (!stats.isDirectory() && !stats.isFile()) {
        result.skipped.push({ relativePath, reason: 'special' })
        continue
      }
      const size = stats.isFile() ? stats.size : 0
      result.entries.push({ relativePath, isDirectory: stats.isDirectory(), size })
      result.totalBytes += size
      if (result.entries.length > maxEntries || result.totalBytes > maxTotalBytes) {
        throw new Error(FILE_TREE_LIST_TOO_LARGE_MESSAGE)
      }
      if (stats.isDirectory()) {
        childDirs.push(relativePath)
      }
    }
    // Reverse so the stack visits children in sorted order.
    pending.push(...childDirs.toReversed())
  }
  return result
}
