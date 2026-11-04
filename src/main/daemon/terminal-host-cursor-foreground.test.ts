import './mock-descendant-sweep'
import { afterEach, expect, it, vi } from 'vitest'
import type { IPty } from 'node-pty'
import { TerminalHost } from './terminal-host'
import { createPtyForegroundProcessTracker } from './pty-subprocess/foreground-process-tracker'
import { confirmPtyProviderForegroundProcess } from '../providers/pty-process-inspection'

const { scan, job } = vi.hoisted(() => ({ scan: vi.fn(), job: vi.fn() }))
vi.mock('../providers/agent-foreground-process', () => ({
  resolveAgentForegroundProcessWithAvailability: scan
}))
vi.mock('../providers/windows-pty-job-membership', () => ({
  readWindowsPtyJobProcessIds: job,
  isWindowsPtyJobReadable: () => true
}))

afterEach(() => vi.restoreAllMocks())

it.each(['detached', 'unreadable'])(
  'keeps Cursor Chat identity through decision inspection (%s job)',
  async (membership) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    scan
      .mockReset()
      .mockResolvedValue({ available: true, processName: 'cursor-agent', processId: 200 })
    job.mockReset().mockReturnValue(new Set([100, 200]))
    const proc: IPty = {
      pid: 100,
      cols: 80,
      rows: 24,
      process: 'powershell.exe',
      handleFlowControl: false,
      onData: () => ({ dispose() {} }),
      onExit: () => ({ dispose() {} }),
      resize: vi.fn(),
      clear: vi.fn(),
      write: vi.fn(),
      kill: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn()
    }
    const tracker = createPtyForegroundProcessTracker({
      process: proc,
      shellPath: proc.process,
      sessionId: 'cursor',
      startupAgentRecognition: null,
      isDead: () => false
    })
    let onExit: ((code: number) => void) | undefined
    const host = new TerminalHost({
      spawnSubprocess: () => ({
        pid: proc.pid,
        getForegroundProcess: tracker.getForegroundProcess,
        confirmForegroundProcess: tracker.confirmForegroundProcess,
        write: vi.fn(),
        resize: vi.fn(),
        kill: () => onExit?.(0),
        forceKill: () => onExit?.(137),
        terminateOwnedTree: () => 'unavailable',
        signal: vi.fn(),
        onData: vi.fn(),
        onExit: (callback) => {
          onExit = callback
        },
        dispose: vi.fn()
      })
    })
    try {
      await host.createOrAttach({
        sessionId: 'cursor',
        cols: 80,
        rows: 24,
        streamClient: { onData: vi.fn(), onExit: vi.fn() }
      })
      const provider = {
        inspectProcess: host.inspectProcess.bind(host),
        confirmForegroundProcess: host.confirmForegroundProcess.bind(host)
      }
      const confirm = () => confirmPtyProviderForegroundProcess(provider, 'cursor')
      await expect(confirm()).resolves.toBe('cursor-agent')
      scan.mockResolvedValue({ available: true, processName: 'powershell.exe' })
      if (membership === 'unreadable') {
        job.mockImplementation(() => {
          throw new Error('job unavailable')
        })
      }
      await expect(confirm()).resolves.toBe('cursor-agent')
      job.mockReturnValue(new Set([100]))
      await expect(confirm()).resolves.toBe('powershell.exe')
    } finally {
      await host.dispose()
    }
  }
)
