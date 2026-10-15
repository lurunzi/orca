import { beforeEach, expect, it, vi } from 'vitest'
import path from 'node:path'
import type * as ClaudeCredentials from '../rate-limits/claude-oauth-credentials'
import { readClaudeFastModeAccountAvailability } from './claude-fast-mode-account-availability'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), read: vi.fn(), keychain: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: mocks.fetch }, session: { defaultSession: {} } }))
vi.mock('node:fs/promises', () => ({ readFile: mocks.read }))
vi.mock('../network/proxy-settings', () => ({ ensureElectronProxyFromEnvironment: vi.fn() }))
vi.mock('../rate-limits/claude-oauth-credentials', async (original) => ({
  ...(await original<typeof ClaudeCredentials>()),
  readClaudeCredentialsFromStrictKeychain: mocks.keychain
}))

const launch = { claudeConfigDir: path.resolve('account-a'), env: {} }
const initialization = {
  account: { apiProvider: 'firstParty', tokenSource: 'oauth', apiKeySource: 'none' }
}
const check: typeof readClaudeFastModeAccountAvailability = readClaudeFastModeAccountAvailability
const read = (input: typeof launch, settings: unknown, account = initialization) =>
  check(input, settings, undefined, account)
const enabled = { supported: true, accountVerified: true }
const unavailable = { supported: false, reason: 'availability-unconfirmed' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.keychain.mockResolvedValue({ token: null })
  mocks.read.mockResolvedValue(JSON.stringify({ claudeAiOauth: { accessToken: 'test-oauth' } }))
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ enabled: true }) })
})

it('checks the pinned account without changing its credentials or billing', async () => {
  expect(await read(launch, {})).toEqual(enabled)
  expect(mocks.read).toHaveBeenCalledWith(
    path.join(launch.claudeConfigDir, '.credentials.json'),
    'utf8'
  )
  expect(mocks.fetch).toHaveBeenCalledWith(
    'https://api.anthropic.com/api/claude_code_penguin_mode',
    expect.objectContaining({
      headers: {
        'User-Agent': 'claude-code/2.1.0',
        Authorization: 'Bearer test-oauth',
        'anthropic-beta': 'oauth-2025-04-20'
      }
    })
  )
})

it('keeps denial, accepts a later permission change, and does not cache permission across accounts', async () => {
  mocks.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ enabled: false, disabled_reason: 'extra_usage_disabled' })
  })
  expect(await read(launch, {})).toEqual({ supported: false, reason: 'extra_usage_disabled' })
  expect(await read(launch, {})).toEqual(enabled)
  mocks.read.mockResolvedValueOnce(
    JSON.stringify({ claudeAiOauth: { accessToken: 'account-b-token' } })
  )
  expect(await read({ ...launch, claudeConfigDir: path.resolve('account-b') }, {})).toEqual(enabled)
  expect(mocks.fetch).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer account-b-token' })
    })
  )
})

it.each([null, {}, { enabled: 'true' }, { enabled: null }])(
  'does not infer permission from malformed data %j',
  async (data) => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => data })
    expect(await read(launch, {})).toEqual(unavailable)
  }
)

it('fails closed after a previously successful check and recovers on retry', async () => {
  expect(await read(launch, {})).toEqual(enabled)
  mocks.fetch.mockRejectedValueOnce(new Error('timeout'))
  expect(await read(launch, {})).toEqual(unavailable)
  expect(await read(launch, {})).toEqual(enabled)
  mocks.fetch.mockResolvedValueOnce({ ok: false })
  expect(await read(launch, {})).toEqual(unavailable)
})

it.each<Record<string, string>>([
  { ANTHROPIC_AUTH_TOKEN: 'gateway-token' },
  { ANTHROPIC_BASE_URL: 'https://gateway.example' },
  { CLAUDE_CODE_USE_BEDROCK: '1' },
  { CLAUDE_CODE_USE_VERTEX: 'true' },
  { CLAUDE_CODE_USE_FOUNDRY: '1' }
])('does not substitute local OAuth for another credential context %j', async (env) => {
  expect(await read({ ...launch, env }, {})).toEqual(unavailable)
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.fetch).not.toHaveBeenCalled()
})

it('uses the effective API key rather than the local subscription account', async () => {
  expect(
    await read(
      launch,
      { env: { ANTHROPIC_API_KEY: 'test-api-key' } },
      {
        account: { apiProvider: 'firstParty', tokenSource: 'api-key', apiKeySource: 'environment' }
      }
    )
  ).toEqual(enabled)
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.fetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: { 'User-Agent': 'claude-code/2.1.0', 'x-api-key': 'test-api-key' }
    })
  )
})

it('requires readable settings and does not resolve an API key helper as local OAuth', async () => {
  expect(await read(launch, null)).toEqual(unavailable)
  expect(await read(launch, { effective: { apiKeyHelper: 'custom-key-command' } })).toEqual(
    unavailable
  )
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.fetch).not.toHaveBeenCalled()
})

it('reads a rotated OAuth token each time, without falling back to another home', async () => {
  mocks.read.mockRejectedValueOnce(new Error('missing account credentials'))
  expect(await read(launch, {})).toEqual(unavailable)
  expect(mocks.fetch).not.toHaveBeenCalled()
  expect(await read(launch, {})).toEqual(enabled)
  expect(
    mocks.read.mock.calls.every(
      ([file]) => file === path.join(launch.claudeConfigDir, '.credentials.json')
    )
  ).toBe(true)
})

it('refuses an unknown or mismatched provider identity instead of checking an unrelated subscription', async () => {
  for (const account of [
    {},
    { apiProvider: 'gateway' },
    { apiProvider: 'firstParty', tokenSource: 'none' },
    { apiProvider: 'firstParty', tokenSource: 'api-key', apiKeySource: 'user' }
  ]) {
    expect(await check(launch, {}, undefined, { account })).toEqual(unavailable)
  }
  expect(mocks.fetch).not.toHaveBeenCalled()
})
