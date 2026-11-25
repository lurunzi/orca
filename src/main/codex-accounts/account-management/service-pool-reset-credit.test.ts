import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installFakeAppEnvironment } from '../../../../config/scripts/test-runtime/environment/vitest-host-ports-setup'
import { buildCodexResetCreditExpectedScope } from '../../../shared/agent-accounts/codex/codex-reset-credit-scope'
import type { CodexResetCreditAttemptLedger } from '../../../shared/agent-accounts/codex/codex-reset-credit-attempt-ledger'
import type { GlobalSettings } from '../../../shared/settings/global-settings-types'
import { createCodexAccountSettings } from './codex-account-settings-fixture'
import {
  createResetCreditLimits,
  createResetRateLimitState
} from './codex-reset-credit-limits.test-fixture'

const testState = vi.hoisted(() => ({ userDataDir: '', fakeHomeDir: '' }))

function createStore(settings: GlobalSettings) {
  let resetLedger: CodexResetCreditAttemptLedger = { version: 1, attempts: [] }
  return {
    getSettings: vi.fn(() => settings),
    updateSettings: vi.fn(),
    getCodexResetCreditAttemptLedger: vi.fn(() => structuredClone(resetLedger)),
    replaceCodexResetCreditAttemptLedgerAndFlush: vi.fn(
      async (next: CodexResetCreditAttemptLedger) => {
        resetLedger = structuredClone(next)
      }
    )
  }
}

function createManagedHome(rootDir: string, accountId: string): string {
  const managedHomePath = join(rootDir, 'codex-accounts', accountId, 'home')
  mkdirSync(managedHomePath, { recursive: true })
  writeFileSync(
    join(managedHomePath, '.orca-managed-home'),
    `${accountId}
`,
    'utf-8'
  )
  return managedHomePath
}

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.userDataDir
  }
}))
beforeEach(() => installFakeAppEnvironment({ getPath: () => testState.userDataDir }))
afterEach(() => vi.unstubAllEnvs())

vi.mock(import('node:os'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    homedir: () => testState.fakeHomeDir
  }
})

describe('Codex pool reset-credit rejection', () => {
  beforeEach(() => {
    vi.resetModules()
    testState.userDataDir = mkdtempSync(join(tmpdir(), 'orca-codex-accounts-'))
    testState.fakeHomeDir = mkdtempSync(join(tmpdir(), 'orca-codex-home-'))
    vi.stubEnv('ORCA_USER_DATA_PATH', testState.userDataDir)
    mkdirSync(join(testState.fakeHomeDir, '.codex'), { recursive: true })
  })
  afterEach(() => {
    rmSync(testState.userDataDir, { recursive: true, force: true })
    rmSync(testState.fakeHomeDir, { recursive: true, force: true })
  })

  it('rejects both service reset entries before local selection, ledger writes or provider reset', async () => {
    vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'instance-1')
    const managedHomePath = createManagedHome(testState.userDataDir, 'account-1')
    const account = {
      id: 'account-1',
      email: 'user@example.com',
      managedHomePath,
      managedHomeRuntime: 'host' as const,
      wslDistro: null,
      createdAt: 1,
      updatedAt: 1,
      lastAuthenticatedAt: 1
    }
    const store = createStore(
      createCodexAccountSettings(testState.fakeHomeDir, {
        codexManagedAccounts: [account],
        activeCodexManagedAccountId: account.id,
        activeCodexManagedAccountIdsByRuntime: { host: account.id, wsl: {} }
      })
    )
    const limits = createResetCreditLimits()
    const state = createResetRateLimitState(limits)
    const rateLimits = {
      refreshForCodexAccountChange: vi.fn().mockResolvedValue(undefined),
      evictInactiveCodexCache: vi.fn(),
      getState: vi.fn(() => state),
      consumeCodexRateLimitResetCredit: vi.fn().mockResolvedValue({ outcome: 'reset', state })
    }
    const runtimeHome = {
      syncForCurrentSelection: vi.fn(),
      clearLastWrittenAuthJson: vi.fn(),
      prepareForRateLimitFetch: vi.fn()
    }
    const expectedScope = buildCodexResetCreditExpectedScope({
      target: state.codexTarget,
      account,
      limits
    })!
    const { CodexAccountService } = await import('../service')
    const { DashboardAllocationError } =
      await import('../../dashboard-accounts/dashboard-allocation-protocol')
    const service = new CodexAccountService(
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the constructor uses this settings/ledger fixture; pool reset refusal precedes further store access.
      store as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: pool reset refusal precedes rate-limit reads and mutations, asserted below.
      rateLimits as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: pool reset refusal precedes runtime-home preparation, asserted below.
      runtimeHome as never
    )
    store.getSettings.mockClear()

    for (const reset of [
      () =>
        service.consumeRateLimitResetCredit('11111111-1111-4111-8111-111111111111', expectedScope),
      () => service.consumeCurrentRateLimitResetCredit()
    ]) {
      const result = reset()
      await expect(result).rejects.toBeInstanceOf(DashboardAllocationError)
      await expect(result).rejects.toMatchObject({
        code: 'dashboard_allocation_unavailable',
        message: 'dashboard_allocation_unavailable'
      })
      await expect(result).rejects.not.toHaveProperty('cause')
    }

    expect(store.getSettings).not.toHaveBeenCalled()
    expect(rateLimits.getState).not.toHaveBeenCalled()
    expect(rateLimits.consumeCodexRateLimitResetCredit).not.toHaveBeenCalled()
    expect(runtimeHome.prepareForRateLimitFetch).not.toHaveBeenCalled()
    expect(store.replaceCodexResetCreditAttemptLedgerAndFlush).not.toHaveBeenCalled()
    expect(store.updateSettings).not.toHaveBeenCalled()
    expect(store.getCodexResetCreditAttemptLedger()).toEqual({ version: 1, attempts: [] })
  })
})
