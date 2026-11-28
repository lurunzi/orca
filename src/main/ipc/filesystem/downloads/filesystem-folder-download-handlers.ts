import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, rename, rm, type FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { IpcHandleRegistrar } from '../../lazy-ipc-handle-group'
import { errnoCodeOrUnknown } from '../../../../shared/errors/errno-code'
import { abortWhenRendererGone } from '../../renderer-requests/renderer-lifetime-abort'
import { DOWNLOAD_SESSION_TTL_MS } from './filesystem-download-promotion'
import { sanitizeLocalDownloadFilename } from './local-download-filename'
import {
  downloadedFolderNameCandidate,
  resolveDownloadedFolderEntryPath
} from './downloaded-folder-entry-path'

type FolderDownloadSession = {
  senderId: number
  parentPath: string
  folderName: string
  stagingPath: string
  openFile: { relativePath: string; handle: FileHandle } | null
  cleanupTimer: NodeJS.Timeout
  disposeRendererLifetime: () => void
}

const MAX_NAME_ATTEMPTS = 1000
const sessions = new Map<string, FolderDownloadSession>()

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`)
  }
  return value
}

function requireSession(senderId: number, transferId: unknown): FolderDownloadSession {
  const session = sessions.get(requireString(transferId, 'transferId'))
  // Another window must not write into, finish or cancel this window's download.
  if (!session || session.senderId !== senderId) {
    throw new Error('Download session not found')
  }
  return session
}

async function closeOpenFile(session: FolderDownloadSession): Promise<void> {
  const current = session.openFile
  session.openFile = null
  await current?.handle.close().catch(() => {})
}

async function endSession(
  transferId: string,
  discard: boolean
): Promise<FolderDownloadSession | null> {
  const session = sessions.get(transferId)
  if (!session) {
    return null
  }
  sessions.delete(transferId)
  clearTimeout(session.cleanupTimer)
  session.disposeRendererLifetime()
  await closeOpenFile(session)
  if (discard) {
    await rm(session.stagingPath, { recursive: true, force: true }).catch(() => {})
  }
  return session
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (errnoCodeOrUnknown(error) === 'ENOENT') {
      return false
    }
    throw error
  }
}

/** Renames the staged folder to the first free name; a concurrent non-empty folder makes rename fail, so retry. */
async function promoteStagedFolder(session: FolderDownloadSession): Promise<string> {
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const destination = join(
      session.parentPath,
      downloadedFolderNameCandidate(session.folderName, attempt)
    )
    if (await pathExists(destination)) {
      continue
    }
    try {
      await rename(session.stagingPath, destination)
      return destination
    } catch (error) {
      // Windows reports a taken name as EPERM; only a name that is now taken is worth another try.
      const code = errnoCodeOrUnknown(error)
      const nameTaken =
        (code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'EPERM') &&
        (await pathExists(destination))
      if (!nameTaken) {
        throw error
      }
    }
  }
  throw new Error('No free folder name in the chosen location')
}

export function registerFilesystemFolderDownloadHandlers(ipc: IpcHandleRegistrar = ipcMain): void {
  ipc.handle(
    'fs:startDownloadedFolder',
    async (
      event,
      args: { suggestedName?: string }
    ): Promise<
      { canceled: true } | { canceled: false; transferId: string; parentPath: string }
    > => {
      const folderName = sanitizeLocalDownloadFilename(
        requireString(args?.suggestedName, 'suggestedName')
      )
      if (event.sender.isDestroyed()) {
        return { canceled: true }
      }
      const lifetime = abortWhenRendererGone(event.sender)
      const transferId = randomUUID()
      const onRendererGone = (): void => {
        void endSession(transferId, true)
      }
      const disposeRendererLifetime = (): void => {
        lifetime.signal.removeEventListener('abort', onRendererGone)
        lifetime.dispose()
      }
      lifetime.signal.addEventListener('abort', onRendererGone, { once: true })
      let admitted = false
      try {
        const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
        const options: Electron.OpenDialogOptions = {
          properties: ['openDirectory', 'createDirectory']
        }
        const picked = parentWindow
          ? await dialog.showOpenDialog(parentWindow, options)
          : await dialog.showOpenDialog(options)
        const parentPath = picked.filePaths[0]
        if (lifetime.signal.aborted || picked.canceled || !parentPath) {
          return { canceled: true }
        }
        // Hidden sibling on the same volume, so the final rename is atomic and a failure leaves no plausible folder.
        const stagingPath = join(parentPath, `.${randomUUID()}.orca-folder-download`)
        await mkdir(stagingPath)
        const cleanupTimer = setTimeout(() => {
          void endSession(transferId, true)
        }, DOWNLOAD_SESSION_TTL_MS)
        cleanupTimer.unref?.()
        sessions.set(transferId, {
          senderId: event.sender.id,
          parentPath,
          folderName,
          stagingPath,
          openFile: null,
          cleanupTimer,
          disposeRendererLifetime
        })
        admitted = true
        return { canceled: false, transferId, parentPath }
      } finally {
        if (!admitted) {
          disposeRendererLifetime()
        }
      }
    }
  )

  ipc.handle(
    'fs:createDownloadedFolderDirectory',
    async (event, args: { transferId?: string; relativePath?: string }): Promise<{ ok: true }> => {
      const session = requireSession(event.sender.id, args?.transferId)
      const target = resolveDownloadedFolderEntryPath(
        session.stagingPath,
        requireString(args?.relativePath, 'relativePath')
      )
      await mkdir(target, { recursive: true })
      return { ok: true }
    }
  )

  ipc.handle(
    'fs:writeDownloadedFolderFileChunk',
    async (
      event,
      args: { transferId?: string; relativePath?: string; contentBase64?: string; append?: boolean }
    ): Promise<{ ok: true }> => {
      const session = requireSession(event.sender.id, args?.transferId)
      const relativePath = requireString(args?.relativePath, 'relativePath')
      const contentBase64 = typeof args?.contentBase64 === 'string' ? args.contentBase64 : ''
      if (args?.append === true) {
        if (session.openFile?.relativePath !== relativePath) {
          throw new Error('No open file to append to')
        }
      } else {
        await closeOpenFile(session)
        const target = resolveDownloadedFolderEntryPath(session.stagingPath, relativePath)
        await mkdir(dirname(target), { recursive: true })
        // `wx`: a name reused within one download (e.g. case-folding) fails instead of overwriting.
        session.openFile = { relativePath, handle: await open(target, 'wx') }
      }
      if (contentBase64) {
        await session.openFile!.handle.writeFile(Buffer.from(contentBase64, 'base64'))
      }
      return { ok: true }
    }
  )

  ipc.handle(
    'fs:finishDownloadedFolder',
    async (event, args: { transferId?: string }): Promise<{ destinationPath: string }> => {
      const session = requireSession(event.sender.id, args?.transferId)
      await endSession(requireString(args?.transferId, 'transferId'), false)
      try {
        return { destinationPath: await promoteStagedFolder(session) }
      } catch (error) {
        await rm(session.stagingPath, { recursive: true, force: true }).catch(() => {})
        throw error
      }
    }
  )

  ipc.handle(
    'fs:cancelDownloadedFolder',
    async (event, args: { transferId?: string }): Promise<{ ok: true }> => {
      requireSession(event.sender.id, args?.transferId)
      await endSession(requireString(args?.transferId, 'transferId'), true)
      return { ok: true }
    }
  )
}
