import { ChildProcess, spawn } from 'node:child_process'
import type * as ChildProcessModule from 'node:child_process'
import { PassThrough } from 'node:stream'
import type * as CliCommandResolution from '../../../shared/shell/command-resolution/node-cli-command-resolution'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { discoverCommitMessageModelsLocal } from '../commit-message-text-generation'

vi.mock('../../pty/process-retirement/windows-process-tree-kill', () => ({
  terminateWindowsProcessTree: vi.fn(async () => {})
}))

vi.mock(
  '../../../shared/shell/command-resolution/node-cli-command-resolution',
  async (importOriginal) => ({
    ...(await importOriginal<typeof CliCommandResolution>()),
    resolveCliCommand: (command: string) => command
  })
)

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  return {
    ...actual,
    spawn: vi.fn(actual.spawn)
  }
})

const spawnMock = vi.mocked(spawn)
const hostPlatform = process.platform

function createMockDiscoveryChild(): ChildProcess & { stdout: PassThrough } {
  const child = new ChildProcess()
  Object.defineProperties(child, {
    stdout: { writable: true, configurable: true, enumerable: true },
    stderr: { writable: true, configurable: true, enumerable: true },
    stdin: { writable: true, configurable: true, enumerable: true }
  })
  return Object.assign(child, {
    pid: 123,
    kill: vi.fn(() => true),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: Object.assign(new PassThrough(), { end: vi.fn() })
  })
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  // Clear PATH so host agent installs cannot answer fake Windows lookups.
  vi.stubEnv('PATH', '')
  spawnMock.mockClear()
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: hostPlatform })
  vi.unstubAllEnvs()
})

// Fork (#22): a detached agent updater opens a visible console window on Windows.
it('keeps the Antigravity CLI from starting its detached updater, which flashes a console', async () => {
  const child = createMockDiscoveryChild()
  spawnMock.mockReturnValueOnce(child)

  const listing = discoverCommitMessageModelsLocal('antigravity', {})
  await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
  const [, , options] = spawnMock.mock.calls[0]
  expect(options?.env?.AGY_CLI_DISABLE_AUTO_UPDATE).toBe('true')

  child.stdout.end('gemini-4-neon-high\tGemini 4 Neon (High)\n')
  child.emit('exit', 0, null)
  child.emit('close', 0, null)
  await listing
})
