import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as NodeFsPromises from 'node:fs/promises'
import {
  installCodexStructuredAccountSwitch,
  resolveCodexStructuredLaunchHome
} from './codex-structured-account-switch'

// Only the rollout itself fails to link, as across volumes; a staged copy would still publish.
const linkFault = vi.hoisted(() => {
  const fault: { source: string | null } = { source: null }
  return fault
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  return {
    ...actual,
    link: async (...args: Parameters<typeof actual.link>) => {
      if (args[0] === linkFault.source) {
        const error: NodeJS.ErrnoException = new Error('EXDEV: cross-device link not permitted')
        error.code = 'EXDEV'
        throw error
      }
      return actual.link(...args)
    }
  }
})

const THREAD_ID = 'abcdef00-1234-4321-9999-cafecafecafe'
const ROLLOUT = join('2026', '11', '08', `rollout-2026-11-08T10-00-00-${THREAD_ID}.jsonl`)

let root: string
let recordHome: string
let selectedHome: string
let pinned: string[]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-codex-account-switch-'))
  vi.stubEnv('ORCA_USER_DATA_PATH', join(root, 'user-data'))
  recordHome = join(root, 'account-a')
  selectedHome = join(root, 'account-b')
  mkdirSync(join(recordHome, 'sessions', '2026', '11', '08'), { recursive: true })
  mkdirSync(selectedHome, { recursive: true })
  writeFileSync(join(recordHome, 'sessions', ROLLOUT), '{"type":"session_meta"}\n')
  pinned = []
  installCodexStructuredAccountSwitch({
    isEnabled: () => true,
    prepareLaunchHome: async () => selectedHome,
    selectableHomes: () => [recordHome, selectedHome],
    systemHomePath: () => join(root, 'system'),
    preparePinnedLaunchHome: async (home) => {
      pinned.push(home)
    },
    workspaceTrustSettings: () => ({ agentWorkspaceTrustEnabled: false })
  })
})

afterEach(() => {
  installCodexStructuredAccountSwitch(undefined)
  linkFault.source = null
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

const launch = () =>
  resolveCodexStructuredLaunchHome({
    recordHome,
    threadId: THREAD_ID,
    launchEnv: {},
    launchDirectory: async () => root
  })

describe('resolveCodexStructuredLaunchHome', () => {
  it('starts under the selected account with the rollout hardlinked into it', async () => {
    await expect(launch()).resolves.toBe(selectedHome)
    const source = statSync(join(recordHome, 'sessions', ROLLOUT))
    const linked = statSync(join(selectedHome, 'sessions', ROLLOUT))
    expect([linked.dev, linked.ino]).toEqual([source.dev, source.ino])
    expect(pinned).toEqual([selectedHome])
  })

  it('refuses rather than copying the rollout when it cannot be hardlinked', async () => {
    linkFault.source = join(recordHome, 'sessions', ROLLOUT)
    await expect(launch()).rejects.toThrow(
      "Orca couldn't move this chat's Codex history into the selected account."
    )
    expect(existsSync(join(selectedHome, 'sessions', ROLLOUT))).toBe(false)
    expect(pinned).toEqual([])
  })

  it("keeps the record's home without the desktop account switch", async () => {
    installCodexStructuredAccountSwitch(undefined)
    await expect(launch()).resolves.toBe(recordHome)
    expect(existsSync(join(selectedHome, 'sessions'))).toBe(false)
  })
})
