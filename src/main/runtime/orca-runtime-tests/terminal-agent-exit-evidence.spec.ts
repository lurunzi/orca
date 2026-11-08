import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncSinglePty } from './orca-runtime-test-fixtures.spec'
import { createSideEffectRuntime } from './orca-runtime-test-scenario-builders.spec'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
})

describe('terminal agent exit evidence', () => {
  it('rescans a Windows ConPTY shell fallback before it counts as an exit', async () => {
    setPlatform('win32')
    const { runtime, batches } = createSideEffectRuntime()
    syncSinglePty(runtime)
    runtime.ingestSyntheticTitleFrame('pty-1', '\x1b]0;Cursor ready\x07')
    const confirmForegroundProcess = vi
      .fn()
      .mockResolvedValueOnce('cursor-agent')
      .mockResolvedValue('powershell.exe')
    runtime.setPtyController({
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => 'powershell.exe',
      confirmForegroundProcess
    })

    runtime.onPtyData('pty-1', '\x1b]0;workspace\x07', 100)
    await vi.waitFor(() => expect(confirmForegroundProcess).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(batches.flatMap((batch) => batch.facts)).not.toContainEqual({ kind: 'agent-exited' })

    runtime.ingestSyntheticTitleFrame('pty-1', '\x1b]0;Cursor ready\x07')
    runtime.onPtyData('pty-1', '\x1b]0;other workspace\x07', 101)
    await vi.waitFor(() =>
      expect(batches.flatMap((batch) => batch.facts)).toContainEqual({ kind: 'agent-exited' })
    )
  })

  it('takes the shell name as evidence off Windows', async () => {
    setPlatform('linux')
    const { runtime, batches } = createSideEffectRuntime()
    syncSinglePty(runtime)
    runtime.ingestSyntheticTitleFrame('pty-1', '\x1b]0;Cursor ready\x07')
    const confirmForegroundProcess = vi.fn().mockResolvedValue('cursor-agent')
    runtime.setPtyController({
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => 'bash',
      confirmForegroundProcess
    })

    runtime.onPtyData('pty-1', '\x1b]0;workspace\x07', 100)
    await vi.waitFor(() =>
      expect(batches.flatMap((batch) => batch.facts)).toContainEqual({ kind: 'agent-exited' })
    )
    expect(confirmForegroundProcess).not.toHaveBeenCalled()
  })
})
