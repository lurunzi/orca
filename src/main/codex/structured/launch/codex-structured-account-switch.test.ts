import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as NodeFsPromises from 'node:fs/promises'
import { agentSessionRecordFixture } from '../../../native-chat/agent-session-record-test-fixture'
import { createCodexStructuredLaunchResolver } from '../../../runtime/agent-session/launch/structured-agent-launch-composition.test-support'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { codexProviderHandle } from '../../../../shared/agent-session/lifecycle/agent-session-provider-handle-encoding'
import {
  configureHostReadableTranscriptPathSources,
  resetHostReadableTranscriptPathCacheForTests
} from '../../../native-chat/host-readable-transcript-path'
import { codexChatAccountSwitchable } from './codex-structured-account-switch'

// Only the rollout fails to link, or one home sits on another volume, as across drives.
const fault = vi.hoisted(() => ({
  linkSource: null as string | null,
  otherVolume: null as string | null,
  systemHome: ''
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  return {
    ...actual,
    link: async (...args: Parameters<typeof actual.link>) => {
      if (args[0] === fault.linkSource) {
        const error: NodeJS.ErrnoException = new Error('EXDEV: cross-device link not permitted')
        error.code = 'EXDEV'
        throw error
      }
      return actual.link(...args)
    },
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const result = await actual.stat(...args)
      return args[0] === fault.otherVolume ? { ...result, dev: Number(result.dev) + 1 } : result
    }
  }
})

vi.mock('../../configuration/homes/codex-home-paths', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSystemCodexHomePath: () => fault.systemHome
}))

const SESSION_ID = 'session-1'
const THREAD_ID = 'abcdef00-1234-4321-9999-cafecafecafe'
const ROLLOUT = join('2026', '11', '08', `rollout-2026-11-08T10-00-00-${THREAD_ID}.jsonl`)

let root: string
let recordHome: string
let selectedHome: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orca-codex-account-switch-'))
  vi.stubEnv('ORCA_USER_DATA_PATH', join(root, 'user-data'))
  recordHome = join(root, 'account-a')
  selectedHome = join(root, 'account-b')
  fault.systemHome = join(root, 'system')
  mkdirSync(join(recordHome, 'sessions', '2026', '11', '08'), { recursive: true })
  mkdirSync(join(selectedHome, 'sessions'), { recursive: true })
  writeFileSync(join(recordHome, 'sessions', ROLLOUT), '{"type":"session_meta"}\n')
  configureHostReadableTranscriptPathSources({
    getAdditionalCodexHomePaths: () => [recordHome, selectedHome]
  })
})

afterEach(() => {
  fault.linkSource = null
  fault.otherVolume = null
  resetHostReadableTranscriptPathCacheForTests()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

const launch = () =>
  createCodexStructuredLaunchResolver({
    store: {
      getRecord: () =>
        agentSessionRecordFixture({
          sessionId: SESSION_ID,
          provider: 'codex',
          location: {
            executionHostId: LOCAL_EXECUTION_HOST_ID,
            wslDistro: null,
            workspaceId: 'workspace-1',
            workspaceKind: 'git-worktree'
          },
          accountHome: { variable: 'CODEX_HOME', path: recordHome },
          providerHandleChain: [
            {
              linkId: 'link-1',
              handle: codexProviderHandle(THREAD_ID),
              origin: 'created',
              mintedAtFence: 1,
              observedAt: 1
            }
          ]
        }),
      pinLaunchDirectory: vi.fn()
    },
    resolveWorkspacePath: async (id) => `/repos/${id}`,
    resolveCommand: () => ({ command: '/usr/local/bin/codex', prefixArgs: [] }),
    resolveLaunchArgs: () => [],
    prepareLaunchAccountHome: async () => ({ variable: 'CODEX_HOME', path: selectedHome })
  })({ identity: { sessionId: SESSION_ID } as never })

describe('Codex chat account switch', () => {
  it('refuses rather than copying the rollout when it cannot be hardlinked', async () => {
    fault.linkSource = join(recordHome, 'sessions', ROLLOUT)
    await expect(launch()).rejects.toThrow(
      "Orca couldn't move this chat's Codex history into the selected account."
    )
    expect(existsSync(join(selectedHome, 'sessions', ROLLOUT))).toBe(false)
  })

  it('lets a chat move only while history sharing is on and every home shares its volume', async () => {
    await expect(codexChatAccountSwitchable(recordHome, {})).resolves.toBe(true)
    await expect(
      codexChatAccountSwitchable(recordHome, { codexShareHistoryAcrossAccounts: false })
    ).resolves.toBe(false)
    fault.otherVolume = join(selectedHome, 'sessions')
    await expect(codexChatAccountSwitchable(recordHome, {})).resolves.toBe(false)
  })
})
