import { beforeEach, describe, expect, it, vi } from 'vitest'

type MainWindowStub = {
  isDestroyed: () => boolean
  isVisible?: () => boolean
  webContents?: {
    isLoading?: () => boolean
    once?: (event: string, handler: () => void) => void
  }
}

const mocks = vi.hoisted(() => {
  const state: { mainWindow: MainWindowStub | null; core: Record<string, unknown> } = {
    mainWindow: null,
    core: {}
  }
  return {
    state,
    requireServices: vi.fn(),
    createWindow: vi.fn(),
    logStartup: vi.fn(),
    safelyRevealWindow: vi.fn()
  }
})

vi.mock('electron', () => ({ app: {} }))
vi.mock('../main-process-state', () => ({ mainProcessState: mocks.state }))
vi.mock('./main-window-service-readiness', () => ({
  requireMainWindowServices: mocks.requireServices
}))
vi.mock('../../window/createMainWindow', () => ({ createMainWindow: mocks.createWindow }))
vi.mock('../diagnostics/startup-diagnostics', () => ({ logStartupMilestone: mocks.logStartup }))
vi.mock('../../crash-reporting/breadcrumbs/crash-breadcrumb-store', () => ({}))
vi.mock('../../crash-reporting/breadcrumbs/durable-crash-breadcrumb', () => ({}))
vi.mock('../../crash-reporting/process-exits/process-gone-classification', () => ({}))
vi.mock('../../telemetry/consent', () => ({}))
vi.mock('../../telemetry/client', () => ({}))
vi.mock('../windows-startup/windows-user-data-acl', () => ({}))
vi.mock('../windows-install-permissions/windows-install-dir-acl-probe', () => ({}))
vi.mock('../windows-install-permissions/windows-install-dir-acl-recovery', () => ({}))
vi.mock('../../window/visibility/main-window-visibility', () => ({}))
vi.mock('../../tray/system-tray', () => ({}))
vi.mock('./main-window-actions', () => ({}))
vi.mock('./main-window-core-services', () => ({}))
vi.mock('./main-window-agent-status', () => ({}))
vi.mock('./main-window-lifecycle-flags', () => ({}))
vi.mock('../gpu-recovery/gpu-lifecycle', () => ({}))
vi.mock('./synthetic-title-runtime', () => ({}))
vi.mock('../../window/activation/focus-existing-window', () => ({
  safelyRevealWindow: mocks.safelyRevealWindow
}))

import { openMainWindow } from './main-window-controller'
import { createMainWindowOpener } from './main-window-reuse'

describe('main window ownership during startup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.mainWindow = null
    mocks.requireServices.mockImplementation(() => {
      throw new Error('startup services not ready')
    })
  })

  it('reuses a window opened by activation before deferred startup resumes', async () => {
    const window = {
      isDestroyed: () => false,
      isVisible: () => true
    }
    mocks.state.mainWindow = window

    await expect(openMainWindow({ revealOnDidFinishLoad: true })).resolves.toBe(window)
    await expect(openMainWindow()).resolves.toBe(window)
    expect(mocks.safelyRevealWindow).not.toHaveBeenCalled()
    expect(mocks.requireServices).not.toHaveBeenCalled()
    expect(mocks.createWindow).not.toHaveBeenCalled()
    expect(mocks.logStartup).not.toHaveBeenCalled()
  })

  it('reveals a hidden loaded window when reused with revealOnDidFinishLoad', async () => {
    const window = {
      isDestroyed: () => false,
      isVisible: () => false,
      webContents: {
        isLoading: () => false,
        once: vi.fn()
      }
    }
    mocks.state.mainWindow = window

    await expect(openMainWindow({ revealOnDidFinishLoad: true })).resolves.toBe(window)
    expect(mocks.safelyRevealWindow).toHaveBeenCalledWith(window)
    expect(window.webContents.once).not.toHaveBeenCalled()
  })

  it('schedules reveal on did-finish-load when reusing an unrevealed loading window', async () => {
    let loadHandler: (() => void) | undefined
    const window = {
      isDestroyed: () => false,
      isVisible: vi.fn(() => false),
      webContents: {
        isLoading: () => true,
        once: vi.fn((event, handler) => {
          if (event === 'did-finish-load') {
            loadHandler = handler
          }
        })
      }
    }
    mocks.state.mainWindow = window

    await expect(openMainWindow({ revealOnDidFinishLoad: true })).resolves.toBe(window)
    expect(mocks.safelyRevealWindow).not.toHaveBeenCalled()
    expect(window.webContents.once).toHaveBeenCalledWith('did-finish-load', expect.any(Function))

    loadHandler?.()
    expect(mocks.safelyRevealWindow).toHaveBeenCalledWith(window)
  })

  it.each([null, { isDestroyed: () => true }])(
    'still checks startup readiness when the previous window is absent or destroyed: %s',
    async (window) => {
      mocks.state.mainWindow = window

      await expect(openMainWindow()).rejects.toThrow('startup services not ready')
      expect(mocks.requireServices).toHaveBeenCalledOnce()
      expect(mocks.createWindow).not.toHaveBeenCalled()
    }
  )

  it('hands a window still preparing its services over only once its open settles', async () => {
    const window: MainWindowStub = { isDestroyed: () => false, isVisible: () => true }
    const shown: { current: MainWindowStub | null } = { current: null }
    const preparing = Promise.withResolvers<MainWindowStub>()
    const open = vi.fn(() => {
      shown.current = window
      return preparing.promise
    })
    const openOrReuse = createMainWindowOpener<MainWindowStub>({
      current: () => shown.current,
      open,
      reveal: vi.fn()
    })

    const first = openOrReuse({})
    let reusedSettled = false
    const reused = openOrReuse({}).finally(() => {
      reusedSettled = true
    })
    await Promise.resolve()
    expect(reusedSettled).toBe(false)

    preparing.reject(new Error('Main window closed while preparing services'))
    await expect(first).rejects.toThrow('Main window closed while preparing services')
    await expect(reused).rejects.toThrow('Main window closed while preparing services')
    expect(open).toHaveBeenCalledOnce()
  })
})
