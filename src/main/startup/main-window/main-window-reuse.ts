import type { BrowserWindow } from 'electron'
import { safelyRevealWindow } from '../../window/activation/focus-existing-window'
import { isWindowlessLaunch } from '../../window/activation/foreground-activation-policy'
import type { MainWindowOpenOptions } from '../../window/main-window/main-window-contracts'

type OpenMainWindow = (options: MainWindowOpenOptions) => Promise<BrowserWindow>

let opening: { window: BrowserWindow | null; ready: Promise<BrowserWindow> } | null = null

/**
 * Fork: activation can open the window while deferred startup is still waiting, so a later open
 * reuses it. A window still preparing its services is handed over only once that open settles, so
 * no caller gets a window the open then destroys.
 */
export async function openOrReuseMainWindow(
  options: MainWindowOpenOptions,
  current: () => BrowserWindow | null,
  open: OpenMainWindow
): Promise<BrowserWindow> {
  const existing = current()
  if (existing && !existing.isDestroyed()) {
    const reused = opening?.window === existing ? await opening.ready : existing
    revealReusedMainWindow(reused, options)
    return reused
  }
  const ready = open(options)
  const entry = { window: current(), ready }
  opening = entry
  try {
    return await ready
  } finally {
    if (opening === entry) {
      opening = null
    }
  }
}

/** A reused unshown window still honors the caller's reveal policy, background included. */
function revealReusedMainWindow(window: BrowserWindow, options: MainWindowOpenOptions): void {
  if (options.revealOnDidFinishLoad !== true || window.isDestroyed() || window.isVisible()) {
    return
  }
  const reveal = (): void => {
    if (window.isDestroyed() || window.isVisible()) {
      return
    }
    if (options.revealInBackground !== true) {
      safelyRevealWindow(window)
    } else if (!isWindowlessLaunch()) {
      window.showInactive()
    }
  }
  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', reveal)
  } else {
    reveal()
  }
}
