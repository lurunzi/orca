import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import { statRuntimePath } from '@/runtime/files/metadata/runtime-file-metadata-client'
import { readRemoteDownloadChunk } from '@/runtime/files/reads/runtime-remote-file-download'
import { getRemoteFileArgs } from '@/runtime/files/runtime-file-routing'
import type { RuntimeFileOperationArgs } from '@/runtime/files/runtime-file-client-types'
import {
  DRAG_OUT_MAX_ENTRY_BYTES,
  type DragOutApi
} from '../../../../../../shared/file-drag-out/drag-out-contract'
import type { TreeNode } from '../tree/file-explorer-types'

const MAX_PREFETCHES_IN_FLIGHT = 2

type ActiveDragOut = { worktreeId: string; sourcePath: string; cachePath: string }

const readyEntryByNode = new Map<string, string>()
const prefetchingNodes = new Set<string>()
let activeDragOut: ActiveDragOut | null = null

function getDragOutApi(): DragOutApi | null {
  if (isWebClientLocation()) {
    return null
  }
  const fs = window.api?.fs
  // The web fallback proxy fabricates members absent from the concrete namespace.
  return fs && 'dragOut' in fs && fs.dragOut ? fs.dragOut : null
}

function nodeKey(worktreeId: string, path: string): string {
  return `${worktreeId}\0${path}`
}

/** Single, non-directory rows a paired runtime owns, on desktop only. */
export function canDragOutRuntimeNode(
  node: TreeNode,
  context: RuntimeFileOperationArgs | null | undefined,
  dragPathCount: number
): context is RuntimeFileOperationArgs & { worktreeId: string } {
  return (
    dragPathCount === 1 &&
    !node.isDirectory &&
    node.operationOwner?.kind === 'runtime' &&
    context?.target.kind === 'environment' &&
    Boolean(context.worktreeId) &&
    getDragOutApi() !== null
  )
}

/** Starts caching the file on pointerdown so a later dragstart can hand the OS a real file. */
export function prefetchRuntimeDragOut(
  node: TreeNode,
  context: RuntimeFileOperationArgs & { worktreeId: string }
): void {
  const api = getDragOutApi()
  const key = nodeKey(context.worktreeId, node.path)
  if (!api || prefetchingNodes.has(key) || prefetchingNodes.size >= MAX_PREFETCHES_IN_FLIGHT) {
    return
  }
  prefetchingNodes.add(key)
  void runPrefetch(api, node, context, key)
    .catch(() => {
      // A failed prefetch only means the drag stays in-app.
      readyEntryByNode.delete(key)
    })
    .finally(() => prefetchingNodes.delete(key))
}

async function runPrefetch(
  api: DragOutApi,
  node: TreeNode,
  context: RuntimeFileOperationArgs & { worktreeId: string },
  key: string
): Promise<void> {
  const remoteArgs = getRemoteFileArgs(context, node.path)
  if (!remoteArgs) {
    return
  }
  const stat = await statRuntimePath(context, node.path)
  if (
    stat.isDirectory ||
    !Number.isSafeInteger(stat.size) ||
    stat.size > DRAG_OUT_MAX_ENTRY_BYTES
  ) {
    readyEntryByNode.delete(key)
    return
  }
  const begin = await api.begin({
    key: {
      environmentId: remoteArgs.target.environmentId,
      worktreeId: context.worktreeId,
      relativePath: remoteArgs.relativePath,
      size: stat.size,
      mtime: stat.mtime
    },
    name: node.name
  })
  if (begin.status === 'rejected' || begin.status === 'writing') {
    // Writing: another prefetch of this version owns it; the next pointerdown finds it complete.
    readyEntryByNode.delete(key)
    return
  }
  if (begin.status === 'complete') {
    readyEntryByNode.set(key, begin.entryId)
    return
  }
  // A changed file must not keep serving the previous version's copy.
  readyEntryByNode.delete(key)
  const { entryId } = begin
  let finished = false
  try {
    let offset = 0
    for (;;) {
      const chunk = await readRemoteDownloadChunk(remoteArgs, offset)
      if (chunk.bytesRead > 0) {
        await api.append({ entryId, contentBase64: chunk.contentBase64 })
      }
      offset += chunk.bytesRead
      if (chunk.eof) {
        break
      }
      if (chunk.bytesRead <= 0) {
        throw new Error('Remote download stalled before reaching EOF')
      }
    }
    await api.finish({ entryId })
    finished = true
    readyEntryByNode.set(key, entryId)
  } finally {
    if (!finished) {
      await api.cancel({ entryId }).catch(() => {})
    }
  }
}

/** The complete cache entry for this row, read synchronously at dragstart. */
export function readyRuntimeDragOutEntry(node: TreeNode, worktreeId: string): string | null {
  return readyEntryByNode.get(nodeKey(worktreeId, node.path)) ?? null
}

/** Main swaps the cancelled HTML5 drag for an OS drag of the cached copy. */
export function startRuntimeDragOut(entryId: string, node: TreeNode, worktreeId: string): void {
  const api = getDragOutApi()
  if (!api) {
    return
  }
  void api
    .start({ entryId })
    .then(({ filePath }) => {
      activeDragOut = { worktreeId, sourcePath: node.path, cachePath: filePath }
      // No HTML5 drag spans a pointerdown, so the next one means this OS drag is over.
      document.addEventListener('pointerdown', () => (activeDragOut = null), {
        once: true,
        capture: true
      })
    })
    .catch((error: unknown) => {
      readyEntryByNode.delete(nodeKey(worktreeId, node.path))
      console.warn('Runtime drag-out failed to start', error)
    })
}

function comparablePath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  return navigator.userAgent.includes('Windows') ? slashed.toLowerCase() : slashed
}

/** The tree node behind an OS drop of the active drag-out copy back into the same explorer. */
export function takeRuntimeDragOutDrop(event: DragEvent, worktreeId: string): string | null {
  const active = activeDragOut
  const files = event.dataTransfer?.files
  if (!active || active.worktreeId !== worktreeId || !files || files.length !== 1) {
    return null
  }
  const fs = window.api?.fs
  const getPathForFile = fs && 'getPathForFile' in fs ? fs.getPathForFile : undefined
  let droppedPath: string | undefined
  try {
    droppedPath = getPathForFile?.(files[0])
  } catch {
    return null
  }
  if (!droppedPath || comparablePath(droppedPath) !== comparablePath(active.cachePath)) {
    return null
  }
  activeDragOut = null
  return active.sourcePath
}
