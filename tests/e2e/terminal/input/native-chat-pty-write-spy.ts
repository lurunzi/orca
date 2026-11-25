import type { ElectronApplication } from '@stablyai/playwright-test'

import { retryTransientMainEvaluate } from '../../desktop/electron-fixtures/electron-main-evaluate-retry'

export type PtyWriteLogEntry = { id: string; data: string }

/** Records every PTY write main receives, so a native chat spec can prove what reached the terminal. */
export async function installTerminalPtyWriteSpy(app: ElectronApplication): Promise<void> {
  await retryTransientMainEvaluate(() =>
    app.evaluate(({ ipcMain }) => {
      const global = globalThis as unknown as {
        __terminalPtyWriteLog?: PtyWriteLogEntry[]
        __terminalPtyWriteSpyInstalled?: boolean
        __terminalPtyWriteAcceptedSpyInstalled?: boolean
      }
      if (global.__terminalPtyWriteSpyInstalled) {
        return
      }
      global.__terminalPtyWriteLog = []
      global.__terminalPtyWriteSpyInstalled = true
      ipcMain.prependListener('pty:write', (_event: unknown, args: PtyWriteLogEntry) => {
        global.__terminalPtyWriteLog!.push({ id: args.id, data: args.data })
      })

      // Playwright cannot observe ipcRenderer.invoke payloads, so this e2e spy wraps main's handler.
      const invokeHandlers = (
        ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, args: PtyWriteLogEntry) => unknown>
        }
      )._invokeHandlers
      const writeAcceptedHandler = invokeHandlers?.get('pty:writeAccepted')
      if (!writeAcceptedHandler || global.__terminalPtyWriteAcceptedSpyInstalled) {
        return
      }
      global.__terminalPtyWriteAcceptedSpyInstalled = true
      invokeHandlers?.set('pty:writeAccepted', (event, args) => {
        global.__terminalPtyWriteLog!.push({ id: args.id, data: args.data })
        return writeAcceptedHandler(event, args)
      })
    })
  )
}

// Idempotent main-process reads and a clear: safe to repeat after a transient CDP failure.
export async function clearTerminalPtyWriteLog(app: ElectronApplication): Promise<void> {
  await retryTransientMainEvaluate(() =>
    app.evaluate(() => {
      const global = globalThis as unknown as { __terminalPtyWriteLog?: PtyWriteLogEntry[] }
      if (global.__terminalPtyWriteLog) {
        global.__terminalPtyWriteLog.length = 0
      }
    })
  )
}

export async function readTerminalPtyWriteEntries(
  app: ElectronApplication
): Promise<PtyWriteLogEntry[]> {
  return retryTransientMainEvaluate(() =>
    app.evaluate(() => {
      const global = globalThis as unknown as { __terminalPtyWriteLog?: PtyWriteLogEntry[] }
      return [...(global.__terminalPtyWriteLog ?? [])]
    })
  )
}
