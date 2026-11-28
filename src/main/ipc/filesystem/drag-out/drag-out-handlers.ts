import { app, ipcMain, nativeImage, type NativeImage, type WebContents } from 'electron'
import appIconPath from '../../../../../resources/icon.png?asset'
import type { IpcHandleRegistrar } from '../../lazy-ipc-handle-group'
import { getOwnedTempStagingRoot } from '../../../filesystem/owned-temp-staging-root'
import { DragOutCache } from './drag-out-cache'
import {
  createDragOutSessionId,
  resolveContainedDragOutPath,
  sweepEarlierDragOutSessions
} from './drag-out-cache-paths'
import type {
  DragOutBeginResult,
  DragOutEntryKey
} from '../../../../shared/file-drag-out/drag-out-contract'

const DRAG_OUT_ICON_SIZE = 64

let cache: DragOutCache | null = null
let dragIcon: NativeImage | null = null
const watchedSenders = new Set<number>()

function productSlug(): string {
  const slug = app
    .getName()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'orca'
}

/** Created on first use: app.setName may change the product name after handlers register. */
function getDragOutCache(): DragOutCache {
  cache ??= new DragOutCache({
    cacheRoot: getOwnedTempStagingRoot(app.getPath('temp'), `${productSlug()}-drag-out`),
    sessionId: createDragOutSessionId()
  })
  return cache
}

async function getDragIcon(filePath: string): Promise<NativeImage> {
  dragIcon ??= nativeImage
    .createFromPath(appIconPath)
    .resize({ width: DRAG_OUT_ICON_SIZE, height: DRAG_OUT_ICON_SIZE })
  // macOS throws on an empty drag icon; fall back to the OS icon for the file type.
  return dragIcon.isEmpty() ? app.getFileIcon(filePath, { size: 'normal' }) : dragIcon
}

function watchSender(sender: WebContents): void {
  if (watchedSenders.has(sender.id)) {
    return
  }
  const senderId = sender.id
  watchedSenders.add(senderId)
  sender.once('destroyed', () => {
    watchedSenders.delete(senderId)
    void cache?.cancelOwner(senderId)
  })
}

function requireEntryId(args: { entryId?: unknown } | undefined): string {
  if (typeof args?.entryId !== 'string' || args.entryId === '') {
    throw new Error('entryId is required')
  }
  return args.entryId
}

export function registerDragOutHandlers(ipc: IpcHandleRegistrar = ipcMain): void {
  ipc.handle(
    'fs:dragOutBegin',
    async (event, args: { key?: DragOutEntryKey; name?: unknown }): Promise<DragOutBeginResult> => {
      if (!args?.key || typeof args.name !== 'string' || args.name === '') {
        throw new Error('key and name are required')
      }
      watchSender(event.sender)
      return getDragOutCache().begin(args.key, args.name, event.sender.id)
    }
  )

  ipc.handle(
    'fs:dragOutAppend',
    async (event, args: { entryId?: string; contentBase64?: unknown }): Promise<{ ok: true }> => {
      const entryId = requireEntryId(args)
      if (typeof args.contentBase64 !== 'string') {
        throw new Error('contentBase64 is required')
      }
      await getDragOutCache().append(
        entryId,
        event.sender.id,
        Buffer.from(args.contentBase64, 'base64')
      )
      return { ok: true }
    }
  )

  ipc.handle(
    'fs:dragOutFinish',
    async (event, args: { entryId?: string }): Promise<{ ok: true }> => {
      await getDragOutCache().finish(requireEntryId(args), event.sender.id)
      return { ok: true }
    }
  )

  ipc.handle(
    'fs:dragOutCancel',
    async (event, args: { entryId?: string }): Promise<{ ok: true }> => {
      await getDragOutCache().cancel(requireEntryId(args), event.sender.id)
      return { ok: true }
    }
  )

  ipc.handle(
    'fs:dragOutStart',
    async (event, args: { entryId?: string }): Promise<{ ok: true; filePath: string }> => {
      const dragCache = getDragOutCache()
      const filePath = await dragCache.resolveDragFile(requireEntryId(args), event.sender.id)
      // Re-check right before the OS sees the path; the renderer never names it.
      const contained = await resolveContainedDragOutPath(dragCache.cacheRoot, filePath)
      const icon = await getDragIcon(contained)
      if (event.sender.isDestroyed()) {
        throw new Error('Drag source window is gone')
      }
      event.sender.startDrag({ file: contained, icon })
      return { ok: true, filePath: contained }
    }
  )

  // Not on drop: the OS may still be copying the file after the drop returns.
  app.on('will-quit', () => {
    void cache?.dispose()
  })
}

/** Removes cache folders left by earlier app sessions; this session's folder is kept. */
export async function sweepEarlierDragOutCacheSessions(): Promise<void> {
  const dragCache = getDragOutCache()
  await sweepEarlierDragOutSessions(dragCache.cacheRoot, dragCache.sessionId)
}
