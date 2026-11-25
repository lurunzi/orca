import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnProcess } from '@orca/process-host'
import type { ProcessSpec } from '@orca/process-host/process-spec'

import {
  openClaudeStreamJsonConnection,
  type ClaudeStreamJsonConnection
} from '../claude-stream-json-connection'
import { CLAUDE_STRUCTURED_BASE_OPTIONS } from '../structured/launch/claude-structured-launch-resolution'
import {
  dashboardClaudeEnvironment,
  DASHBOARD_CLAUDE_ENV_TO_DELETE
} from '../../dashboard-accounts/dashboard-claude-environment'
import {
  DashboardAllocationState,
  DashboardToolProvider
} from '../../dashboard-accounts/dashboard-allocation-protocol'

// Exercise the real SDK against a scripted child CLI.
const FAKE_CLI = join(__dirname, '../__fixtures__', 'claude-agent-sdk-scripted-cli.mjs')
const SESSION_ID = '5348c19f-6a54-4c2e-9c68-9c2b1a3d4e5f'
const HOLD_OPEN = { delayMs: 10_000 }

const scratchDirs: string[] = []
const openConnections: ClaudeStreamJsonConnection[] = []
const childClosures: Promise<void>[] = []
const spawned: ProcessSpec[] = []

afterEach(async () => {
  for (const connection of openConnections.splice(0)) {
    await connection.close()
  }
  await Promise.all(childClosures.splice(0))
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
  spawned.splice(0)
  vi.unstubAllEnvs()
})

function scriptedCwdAndEnv(steps: Record<string, unknown>[]) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-sdk-connection-'))
  scratchDirs.push(dir)
  const scenarioPath = join(dir, 'scenario.json')
  writeFileSync(scenarioPath, JSON.stringify({ steps, controlResponses: {} }))
  return {
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? '',
      ORCA_SDK_CONTRACT_SCENARIO_PATH: scenarioPath,
      ORCA_SDK_CONTRACT_REPORT_PATH: join(dir, 'report.json')
    }
  }
}

describe('Claude stream-json connection with a pool account', () => {
  it('passes only pool OAuth authentication through the real SDK to its scripted child', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-inherited-key')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://fixture.invalid')
    vi.stubEnv('CLAUDE_CODE_USE_BEDROCK', '1')
    const env = dashboardClaudeEnvironment(
      { ANTHROPIC_AUTH_TOKEN: 'fixture-conflict', HTTPS_PROXY: 'http://proxy.invalid' },
      {
        provider: DashboardToolProvider.ClaudeCode,
        state: DashboardAllocationState.Available,
        account_id: 'fixture-pool',
        binding_revision: 1,
        credential_version: 1,
        access_token: 'fixture-pool-access',
        expires_at: null
      }
    )
    const scenario = scriptedCwdAndEnv([HOLD_OPEN])
    const connection = await openClaudeStreamJsonConnection(
      {
        pathToClaudeCodeExecutable: FAKE_CLI,
        options: { ...CLAUDE_STRUCTURED_BASE_OPTIONS, sessionId: SESSION_ID },
        cwd: scenario.cwd,
        env: { ...scenario.env, ...env },
        envToDelete: DASHBOARD_CLAUDE_ENV_TO_DELETE
      },
      {},
      (spec) => {
        spawned.push(spec)
        const child: ChildProcess = spawnProcess(spec)
        childClosures.push(new Promise<void>((resolve) => child.once('close', () => resolve())))
        return child
      }
    )
    openConnections.push(connection)
    await connection.initializationResult()
    const childEnv = spawned.at(-1)?.env
    expect(childEnv?.CLAUDE_CODE_OAUTH_TOKEN).toBe('fixture-pool-access')
    expect(childEnv?.ANTHROPIC_API_KEY).toBeUndefined()
    expect(childEnv?.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(childEnv?.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(childEnv?.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(childEnv?.HTTPS_PROXY).toBe('http://proxy.invalid')
  })
})
