import type { BrowserWindow } from 'electron'
import { safelyRevealWindow } from '../../window/activation/focus-existing-window'
import { isWindowlessLaunch } from '../../window/activation/foreground-activation-policy'
import type { MainWindowOpenOptions } from '../../window/main-window/main-window-contracts'

/**
 * Fork: activation can open the window while deferred startup is still waiting, so a later open
 * reuses it. A window still preparing its services is handed over only once that open settles, so
 * no caller gets a window the open then destroys.
 */
export function createMainWindowOpener<W extends { isDestroyed: () => boolean }>(deps: {
  current: () => W | null
  open: (options: MainWindowOpenOptions) => Promise<W>
  reveal: (window: W, options: MainWindowOpenOptions) => void
}): (options: MainWindowOpenOptions) => Promise<W> {
  let opening: { window: W | null; ready: Promise<W> } | null = null
  return async (options) => {
    const existing = deps.current()
    if (existing && !existing.isDestroyed()) {
      const reused = opening?.window === existing ? await opening.ready : existing
      deps.reveal(reused, options)
      return reused
    }
    const ready = deps.open(options)
    const entry = { window: deps.current(), ready }
    opening = entry
    try {
      return await ready
    } finally {
      if (opening === entry) {
        opening = null
      }
    }
  }
}

/** A reused unshown window still honors the caller's reveal policy, background included. */
export function revealReusedMainWindow(
  window: BrowserWindow,
  options: MainWindowOpenOptions
): void {
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
