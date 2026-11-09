import '../../../unused-default-rpc-methods.test-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { agentSessionRecordFixture } from '../../../../../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import { createGlobalSettingsFixture } from '../../../../../../shared/global-settings-test-fixture'
import { setStructuredAgentSessionHost } from '../../../../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import {
  createResetCreditLimits,
  createResetRateLimitState
} from '../../../../../codex-accounts/service-reset-credit-test-fixtures'
import {
  call,
  clearStructuredHostStub,
  hostStub
} from '../protocol/structured-agent-session-rpc.test-fixture'
import { SESSION } from '../protocol/structured-agent-session-rpc-client.test-fixture'
import { CodexUsageApiKeyAuthError } from '../../../../../rate-limits/codex-rpc-rate-limit-mapper'
import { sessionAccountUsageOffer } from './structured-agent-session-account-usage'
import { AgentSessionPoolAccountOrigin } from '../../../../../../shared/agent-session/lifecycle/agent-session-pool-account'
import type { AgentSessionRecord } from '../../../../../../shared/agent-session/lifecycle/agent-session-record'
import { DashboardToolProvider } from '../../../../../../shared/dashboard-account-provider'

const account = {
  id: 'work',
  email: 'work@example.com',
  managedHomePath: '/accounts/work',
  createdAt: 1,
  updatedAt: 7,
  lastAuthenticatedAt: 1
}
const settings = createGlobalSettingsFixture({
  codexManagedAccounts: [account],
  activeCodexManagedAccountId: account.id
})
const record = {
  ...agentSessionRecordFixture(),
  sessionId: SESSION,
  provider: 'codex',
  accountHome: { variable: 'CODEX_HOME', path: account.managedHomePath }
}
const state = createResetRateLimitState(createResetCreditLimits(123))
afterEach(clearStructuredHostStub)

function install(
  read = vi.fn(async () => ({ rateLimits: createResetCreditLimits(999) })),
  pinned = record
) {
  const host = hostStub()
  Object.assign(host, {
    deps: {
      store: { getRecord: () => pinned },
      agents: { registration: () => ({ adapter: { readAccountUsage: read } }) }
    }
  })
  setStructuredAgentSessionHost(host)
  return {
    read,
    overrides: {
      requireStore: () => ({ getSettings: () => settings }),
      getUsageRateLimits: () => ({ getState: () => state })
    }
  }
}

async function usage(overrides: Record<string, unknown>) {
  const reply = await call(
    'agentSession.accountUsage',
    { sessionId: SESSION },
    undefined,
    overrides
  )
  if (!reply?.ok) {
    throw new Error('usage request failed')
  }
  return reply.result
}

describe('chat account usage', () => {
  it('publishes pool quota as shared without provider email, local reset or internal metadata', async () => {
    const { overrides } = install(
      vi.fn().mockResolvedValue({
        pool: true,
        live: true,
        account: { type: 'chatgpt', email: 'private-provider@example.com' },
        rateLimits: createResetCreditLimits(999)
      })
    )
    const result = await usage(overrides)
    expect(result).toMatchObject({ status: 'ok', rateLimits: { updatedAt: 999 } })
    expect(result).toHaveProperty('account', { kind: 'shared' })
    expect(result).not.toHaveProperty('reset')
    expect(result).not.toHaveProperty('pool')
    expect(result).not.toHaveProperty('poolAccount')

    const pinned = {
      ...record,
      poolAccount: {
        version: 1,
        origin: AgentSessionPoolAccountOrigin.Authenticated,
        instanceId: 'instance-fixture',
        provider: DashboardToolProvider.Codex,
        accountId: 'pool-fixture',
        bindingRevision: 1,
        credentialVersion: 2
      }
    } satisfies AgentSessionRecord
    expect(sessionAccountUsageOffer(pinned, settings, state)).toEqual({
      account: { kind: 'shared' }
    })
  })

  it('uses the pinned home for the read and the host service snapshot for the reset offer', async () => {
    const { read, overrides } = install()
    expect(await usage(overrides)).toMatchObject({
      status: 'ok',
      account: { kind: 'managed', email: 'work@example.com' },
      rateLimits: { updatedAt: 999 },
      reset: {
        available: 1,
        expectedScope: {
          accountId: 'work',
          accountRevision: 7,
          offerRevision: expect.stringContaining('123')
        }
      }
    })
    expect(read).toHaveBeenCalledWith(record, expect.any(AbortSignal))
  })

  it.each([
    [
      { code: -32601, message: 'Method not found' },
      { status: 'unsupported', reason: 'codexVersion' }
    ],
    [new CodexUsageApiKeyAuthError(), { status: 'unsupported', reason: 'apiKeyAuth' }],
    [new Error('network unavailable'), { status: 'failed' }]
  ])('classifies provider failure %s without publishing provider text', async (error, expected) => {
    const { overrides } = install(vi.fn().mockRejectedValue(error))
    expect(await usage(overrides)).toEqual(expected)
  })

  it('never offers a reset for another selected account, runtime, or a system/shared home', async () => {
    expect(
      sessionAccountUsageOffer(record, { ...settings, activeCodexManagedAccountId: 'other' }, state)
        .reset
    ).toBeUndefined()
    expect(
      sessionAccountUsageOffer(record, settings, {
        ...state,
        codexTarget: { runtime: 'wsl', wslDistro: 'Ubuntu' }
      }).reset
    ).toBeUndefined()
    const system = {
      ...record,
      accountHome: { variable: 'CODEX_HOME', path: join(homedir(), '.codex') }
    }
    expect(sessionAccountUsageOffer(system, settings, state)).toEqual({
      account: { kind: 'system' }
    })
    const { overrides } = install(undefined, {
      ...record,
      accountHome: { variable: 'CODEX_HOME', path: '/mirror' }
    })
    expect(await usage(overrides)).toMatchObject({
      status: 'ok',
      account: { kind: 'shared' }
    })
    expect(
      sessionAccountUsageOffer(
        { ...record, accountHome: { variable: 'CODEX_HOME', path: '/mirror' } },
        settings,
        state
      ).reset
    ).toBeUndefined()
  })
})
