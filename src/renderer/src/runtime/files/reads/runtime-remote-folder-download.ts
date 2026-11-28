import {
  FILE_TREE_LIST_TOO_LARGE_MESSAGE,
  type FileTreeListResult
} from '../../../../../shared/file-listing/file-tree-listing'
import { callRuntimeRpc } from '../../rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '../../rpc/calls/runtime-rpc-result'
import type { RuntimeFileOperationArgs } from '../runtime-file-client-types'
import { getRemoteFileArgs, joinRuntimeRelativePath } from '../runtime-file-routing'
import { readRemoteDownloadChunk } from './runtime-remote-file-download'

export const FOLDER_DOWNLOAD_UPDATE_REQUIRED_MESSAGE =
  'Folder download requires a newer Orca server. Update the headless server and try again.'
export const FOLDER_DOWNLOAD_TOO_LARGE_MESSAGE =
  'This folder is too large to download at once (over 20,000 items or 8 GB). Download its subfolders instead.'

export type RuntimeFolderDownloadProgress = {
  filesDone: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
}

export type RuntimeFolderDownloadResult =
  | { canceled: true }
  | { canceled: false; destinationPath: string; skippedCount: number }

/** Lists a host folder, then pages each file into a local folder that main names without overwriting. */
export async function downloadRuntimeFolder(
  context: RuntimeFileOperationArgs,
  dirPath: string,
  suggestedName: string,
  options: { signal?: AbortSignal; onProgress?: (progress: RuntimeFolderDownloadProgress) => void }
): Promise<RuntimeFolderDownloadResult> {
  const remoteArgs = getRemoteFileArgs(context, dirPath)
  if (!remoteArgs) {
    throw new Error('Folder is outside the owning runtime worktree')
  }
  const listing = await listRemoteFolder(remoteArgs)
  options.signal?.throwIfAborted()
  const start = await window.api.fs.startDownloadedFolder({ suggestedName })
  if (start.canceled) {
    return start
  }
  const { transferId } = start
  const progress: RuntimeFolderDownloadProgress = {
    filesDone: 0,
    filesTotal: listing.entries.filter((entry) => !entry.isDirectory).length,
    bytesDone: 0,
    bytesTotal: listing.totalBytes
  }
  options.onProgress?.({ ...progress })
  let skippedCount = listing.skipped.length
  const refusedDirectories: string[] = []
  let finished = false
  try {
    for (const entry of listing.entries) {
      options.signal?.throwIfAborted()
      if (refusedDirectories.some((dir) => entry.relativePath.startsWith(`${dir}/`))) {
        skippedCount += 1
        continue
      }
      try {
        if (entry.isDirectory) {
          await window.api.fs.createDownloadedFolderDirectory({
            transferId,
            relativePath: entry.relativePath
          })
          continue
        }
        await copyRemoteFile(
          remoteArgs,
          transferId,
          entry.relativePath,
          options.signal,
          (bytes) => {
            progress.bytesDone += bytes
            options.onProgress?.({ ...progress })
          }
        )
        progress.filesDone += 1
        options.onProgress?.({ ...progress })
      } catch (error) {
        // A name this computer cannot store is skipped and counted; any other failure ends the download.
        if (!isRefusedEntryName(error)) {
          throw error
        }
        skippedCount += 1
        if (entry.isDirectory) {
          refusedDirectories.push(entry.relativePath)
        }
      }
    }
    const { destinationPath } = await window.api.fs.finishDownloadedFolder({ transferId })
    finished = true
    return { canceled: false, destinationPath, skippedCount }
  } finally {
    if (!finished) {
      await window.api.fs.cancelDownloadedFolder({ transferId }).catch(() => {})
    }
  }
}

type RemoteFolderArgs = NonNullable<ReturnType<typeof getRemoteFileArgs>>

async function listRemoteFolder(remoteArgs: RemoteFolderArgs): Promise<FileTreeListResult> {
  try {
    return await callRuntimeRpc<FileTreeListResult>(
      remoteArgs.target,
      'files.listTree',
      { worktree: remoteArgs.worktreeSelector, relativePath: remoteArgs.relativePath },
      { timeoutMs: 120_000 }
    )
  } catch (error) {
    if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
      throw new Error(FOLDER_DOWNLOAD_UPDATE_REQUIRED_MESSAGE)
    }
    if (error instanceof Error && error.message === FILE_TREE_LIST_TOO_LARGE_MESSAGE) {
      throw new Error(FOLDER_DOWNLOAD_TOO_LARGE_MESSAGE)
    }
    throw error
  }
}

async function copyRemoteFile(
  remoteArgs: RemoteFolderArgs,
  transferId: string,
  entryRelativePath: string,
  signal: AbortSignal | undefined,
  onBytes: (bytes: number) => void
): Promise<void> {
  const fileArgs = {
    ...remoteArgs,
    relativePath: joinRuntimeRelativePath(remoteArgs.relativePath, entryRelativePath)
  }
  let offset = 0
  for (;;) {
    signal?.throwIfAborted()
    const chunk = await readRemoteDownloadChunk(fileArgs, offset)
    // The first write creates the file even when it is empty.
    if (offset === 0 || chunk.bytesRead > 0) {
      await window.api.fs.writeDownloadedFolderFileChunk({
        transferId,
        relativePath: entryRelativePath,
        contentBase64: chunk.contentBase64,
        append: offset > 0
      })
    }
    offset += chunk.bytesRead
    onBytes(chunk.bytesRead)
    if (chunk.eof) {
      return
    }
    if (chunk.bytesRead <= 0) {
      throw new Error('Remote download stalled before reaching EOF')
    }
  }
}

function isRefusedEntryName(error: unknown): boolean {
  return error instanceof Error && error.message.includes('invalid_entry_name')
}
