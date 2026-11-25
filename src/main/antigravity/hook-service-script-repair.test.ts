import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn<() => string>()
}))

vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as Record<string, unknown>
  return {
    ...actual,
    homedir: homedirMock
  }
})

import { AntigravityHookService } from './hook-service'

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  try {
    return run()
  } finally {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  }
}

// Fork: a managed hook whose script is gone reports partial so Install repairs it.
describe('AntigravityHookService managed script repair', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'orca-antigravity-home-'))
    homedirMock.mockReturnValue(homeDir)
  })

  afterEach(() => {
    vi.clearAllMocks()
    rmSync(homeDir, { recursive: true, force: true })
  })

  it.each(['darwin', 'win32'] as const)(
    'reports and repairs a missing core script on %s',
    (platform) => {
      withPlatform(platform, () => {
        const service = new AntigravityHookService()
        expect(service.install().state).toBe('installed')
        const filename = platform === 'win32' ? 'antigravity-hook.cmd' : 'antigravity-hook.sh'
        rmSync(join(homeDir, '.orca', 'agent-hooks', filename))
        expect(service.getStatus()).toMatchObject({ state: 'partial', managedHooksPresent: true })
        expect(service.getStatus().detail).toContain(filename)
        expect(service.install().state).toBe('installed')
      })
    }
  )

  it('reports and repairs a missing Windows event wrapper', () => {
    withPlatform('win32', () => {
      const service = new AntigravityHookService()
      service.install()
      rmSync(join(homeDir, '.orca', 'agent-hooks', 'antigravity-pre-tool-use.cmd'))
      expect(service.getStatus()).toMatchObject({ state: 'partial', managedHooksPresent: true })
      expect(service.getStatus().detail).toContain('antigravity-pre-tool-use.cmd')
      expect(service.install().state).toBe('installed')
    })
  })

  it('reinstalls a wiped bundle and missing scripts while preserving user hooks', () => {
    withPlatform('win32', () => {
      const service = new AntigravityHookService()
      service.install()
      const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
      const userHooks = { 'user-hook': { Stop: [{ type: 'command', command: 'user-hook' }] } }
      writeFileSync(configPath, JSON.stringify(userHooks))
      rmSync(join(homeDir, '.orca', 'agent-hooks', 'antigravity-pre-tool-use.cmd'))
      expect(service.getStatus().state).toBe('not_installed')
      expect(service.install().state).toBe('installed')
      expect(JSON.parse(readFileSync(configPath, 'utf8'))).toMatchObject(userHooks)
      expect(
        readFileSync(join(homeDir, '.orca', 'agent-hooks', 'antigravity-pre-tool-use.cmd'), 'utf8')
      ).toContain('ORCA_ANTIGRAVITY_EVENT=PreToolUse')
    })
  })
})
