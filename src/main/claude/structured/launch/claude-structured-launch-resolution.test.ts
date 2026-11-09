import { agentSessionRecordFixture } from '../../../native-chat/agent-session-record-test-fixture'
import * as dashboardAllocation from '../../../dashboard-accounts/dashboard-allocation-reader'
import {
  DashboardAllocationError,
  DashboardAllocationState,
  DashboardToolProvider
} from '../../../dashboard-accounts/dashboard-allocation-protocol'
import { createClaudeStructuredLaunchResolver } from '../../../runtime/agent-session/launch/structured-agent-launch-composition.test-support'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { claudeProviderHandle } from '../../../../shared/agent-session/lifecycle/agent-session-provider-handle-encoding'

const SESSION_ID = 'orca-session-1'
const IDENTITY = { sessionId: SESSION_ID } as Parameters<
  ReturnType<typeof createClaudeStructuredLaunchResolver>
>[0]['identity']

function record(overrides: Partial<AgentSessionRecord> = {}): AgentSessionRecord {
  return agentSessionRecordFixture({
    sessionId: SESSION_ID,
    provider: 'claude',
    location: {
      executionHostId: LOCAL_EXECUTION_HOST_ID,
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'folder'
    },
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/home/work/.claude' },
    providerHandleChain: [],
    ...overrides
  })
}

function identityAt(leafUuid: string | null): typeof IDENTITY {
  return {
    ...IDENTITY,
    providerHandle: claudeProviderHandle('provider-current', leafUuid)
  }
}

function resolverFor(
  value: AgentSessionRecord | null,
  resolveEnv?: () => Record<string, string>,
  account: 'managed' | 'system' = 'system',
  hasTranscript: () => Promise<boolean> = async () => true,
  resolveLaunchArgs?: () => string[],
  attachmentDirectory?: string
) {
  return createClaudeStructuredLaunchResolver({
    store: { getRecord: () => value, pinLaunchDirectory: vi.fn() },
    resolveWorkspacePath: async (id) => `/repos/${id}`,
    resolveCommand: () => ({ command: '/usr/local/bin/claude', prefixArgs: [] }),
    resolveAuthPolicy: () => ({ account }),
    hasTranscript,
    resolveLaunchArgs: resolveLaunchArgs ?? (() => value?.launchArgs ?? []),
    ...(resolveEnv ? { resolveEnv } : {}),
    ...(attachmentDirectory ? { attachmentDirectory } : {})
  })
}

const RESUMABLE = record({
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only each link's handle, so the link's other fields stay unset.
  providerHandleChain: [
    { handle: claudeProviderHandle('provider-current', 'leaf-current') }
  ] as AgentSessionRecord['providerHandleChain']
})

describe('claude structured launch resolution', () => {
  it('reads the pool allocation at each launch and replaces conflicting authentication', async () => {
    const allocation = {
      provider: DashboardToolProvider.ClaudeCode,
      state: DashboardAllocationState.Available,
      account_id: 'fixture-pool',
      binding_revision: 1,
      credential_version: 1,
      access_token: 'fixture-pool-access',
      expires_at: null
    } as const
    const read = vi
      .spyOn(dashboardAllocation, 'readDashboardClaudeAllocation')
      .mockResolvedValue(allocation)
    try {
      const resolve = resolverFor(record(), () => ({
        ANTHROPIC_API_KEY: 'conflicting-key',
        ANTHROPIC_AUTH_TOKEN: 'conflicting-token',
        ANTHROPIC_CUSTOM_HEADERS: 'Authorization: conflicting-header',
        ANTHROPIC_BASE_URL: 'https://fixture.invalid',
        CLAUDE_CODE_USE_BEDROCK: '1',
        HTTPS_PROXY: 'http://proxy.invalid',
        ORDINARY_SETTING: 'preserved'
      }))
      const launch = await resolve({ identity: IDENTITY })
      expect(launch.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe('fixture-pool-access')
      expect(launch.dashboardBinding).toEqual({
        account_id: 'fixture-pool',
        binding_revision: 1,
        credential_version: 1
      })
      for (const key of [
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_CUSTOM_HEADERS',
        'ANTHROPIC_BASE_URL',
        'CLAUDE_CODE_USE_BEDROCK'
      ]) {
        expect(launch.env?.[key]).toBeUndefined()
      }
      expect(launch.env).toMatchObject({
        HTTPS_PROXY: 'http://proxy.invalid',
        ORDINARY_SETTING: 'preserved'
      })
      expect(launch.envToDelete).toContain('CLAUDE_CODE_USE_BEDROCK')
      expect(launch.claudeConfigDir).toBe('/home/work/.claude')
      read.mockResolvedValue({
        ...allocation,
        credential_version: 2,
        access_token: 'fixture-pool-new-access'
      })
      const refreshed = await resolve({ identity: IDENTITY })
      expect(refreshed.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe('fixture-pool-new-access')
      expect(refreshed.dashboardBinding).toEqual({
        account_id: 'fixture-pool',
        binding_revision: 1,
        credential_version: 2
      })
      expect(launch.dashboardBinding?.credential_version).toBe(1)
      read.mockRejectedValue(new DashboardAllocationError())
      await expect(resolve({ identity: IDENTITY })).rejects.toThrow(
        'dashboard_allocation_unavailable'
      )
    } finally {
      read.mockRestore()
    }
  })

  it('launches when only the bookkeeping leaf moved, and refuses a changed session', async () => {
    const resolve = resolverFor(RESUMABLE)

    // A failed turn-end or exit write leaves the identity's leaf behind the record's.
    await expect(resolve({ identity: identityAt('leaf-stale') })).resolves.toMatchObject({
      providerSessionId: 'provider-current',
      resumeLeafUuid: 'leaf-current'
    })
    await expect(
      resolve({
        identity: {
          ...IDENTITY,
          providerHandle: claudeProviderHandle('provider-other', 'leaf-current')
        }
      })
    ).rejects.toThrow('durable resume identity changed before spawn')
  })
})
