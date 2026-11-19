import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentSessionJournalIdentity } from '../../shared/agent-session/journal/agent-session-journal-identity'
import { claudeProviderHandle } from '../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle-encoding'
import { DashboardAllocationErrorCode } from '../dashboard-accounts/dashboard-allocation-protocol'
import { claudeStartupSettled } from './structured/startup/claude-structured-startup-settled-test-support'
import { CLAUDE_STRUCTURED_BASE_OPTIONS } from './structured/launch/claude-structured-launch-resolution'
import {
  realClaudeAvailable,
  realClaudeCliGate,
  realClaudeCommand
} from './claude-real-cli-availability-test-support'
import { ClaudeStructuredSessionAdapter } from './structured/claude-structured-session-adapter'

const suiteTitle = `Claude pool launch source on the real CLI${realClaudeCliGate.skipReason ? ` (skipped: ${realClaudeCliGate.skipReason})` : ''}`
const SESSION_ID = 'real-cli-pool-source'

/** Isolate SessionStart proof from the machine's hook settings. */
async function projectWithStartHook(prefix: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(cwd, '.claude'), { recursive: true })
  await writeFile(
    join(cwd, '.claude', 'settings.json'),
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'true' }] }] } })
  )
  return cwd
}

describe.skipIf(!realClaudeAvailable)(suiteTitle, () => {
  it.skipIf(process.platform !== 'linux').each<{
    name: string
    env: Record<string, string>
    accepted: boolean
  }>([
    {
      name: 'OAuth environment',
      env: { CLAUDE_CODE_OAUTH_TOKEN: 'fixture-claude-access-token-not-real' },
      accepted: true
    },
    {
      name: 'API key environment',
      env: { ANTHROPIC_API_KEY: 'fixture-claude-api-key-not-real' },
      accepted: false
    }
  ])(
    'checks a pool $name using the real SDK without a model request',
    async ({ env, accepted }) => {
      const claudeConfigDir = await mkdtemp(join(tmpdir(), 'orca-claude-pool-source-'))
      const cwd = await projectWithStartHook('orca-pool-source-')
      const providerSessionId = randomUUID()
      const adapter = new ClaudeStructuredSessionAdapter({
        resolveLaunch: async () => ({
          pathToClaudeCodeExecutable: realClaudeCommand,
          options: { ...CLAUDE_STRUCTURED_BASE_OPTIONS, sessionId: providerSessionId },
          cwd,
          env,
          claudeConfigDir,
          providerSessionId,
          resumeLeafUuid: null,
          resumesTranscript: false,
          continuesChain: false,
          cliFlag: async () => 'supported' as const,
          dashboardBinding: {
            account_id: 'fixture-pool-account',
            binding_revision: 1,
            credential_version: 1
          }
        }),
        readProcessStartTime: async () => 1,
        now: () => 2
      })
      const identity: AgentSessionJournalIdentity = {
        sessionId: SESSION_ID,
        workspaceId: 'real-cli-workspace',
        hostId: 'local',
        agent: 'claude',
        providerHandle: claudeProviderHandle(providerSessionId, null)
      }
      try {
        const opening = adapter
          .acquire({ identity, fence: 1, spawnToken: 'real-cli-pool-source' })
          .then(() => claudeStartupSettled(adapter, SESSION_ID))
        if (accepted) {
          await opening
          expect(adapter.readDashboardClaudeLaunches().processes).toMatchObject([
            { initialized: true }
          ])
        } else {
          await expect(opening).rejects.toMatchObject({
            message: DashboardAllocationErrorCode.Unavailable
          })
          expect(
            adapter.readDashboardClaudeLaunches().processes.filter((process) => process.initialized)
          ).toEqual([])
        }
      } finally {
        await adapter.closeAll()
        expect(relative(tmpdir(), claudeConfigDir)).toMatch(/^orca-claude-pool-source-[^\\/]+$/)
        expect(relative(tmpdir(), cwd)).toMatch(/^orca-pool-source-[^\\/]+$/)
        await rm(claudeConfigDir, { recursive: true, force: true })
        await rm(cwd, { recursive: true, force: true })
      }
    },
    30_000
  )
})
