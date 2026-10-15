import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { net, session } from 'electron'
import type { AgentSessionFastModeSupport } from '../../shared/agent-session-wire'
import type { ClaudeStructuredLaunch } from './claude-structured-launch-resolution'
import { record, text } from './claude-structured-model-catalog'
import {
  parseClaudeOAuthCredentialsJson,
  readClaudeCredentialsFromStrictKeychain
} from '../rate-limits/claude-oauth-credentials'
import { ensureElectronProxyFromEnvironment } from '../network/proxy-settings'

const AVAILABILITY_URL = 'https://api.anthropic.com/api/claude_code_penguin_mode'

export function unconfirmedClaudeFastMode(): AgentSessionFastModeSupport {
  return { supported: false, reason: 'availability-unconfirmed' }
}

async function accountToken(configDir: string): Promise<string | null> {
  if (process.platform === 'darwin') {
    const isDefault = path.resolve(configDir) === path.join(homedir(), '.claude')
    const credentials = await readClaudeCredentialsFromStrictKeychain(
      isDefault ? undefined : configDir,
      isDefault ? 'legacy-keychain' : 'scoped-keychain'
    )
    if (credentials.token) {
      return credentials.token
    }
  }
  const raw = await readFile(path.join(configDir, '.credentials.json'), 'utf8').catch(() => null)
  return raw ? parseClaudeOAuthCredentialsJson(raw, 'credentials-file').token : null
}

/** Uses only the execution host's pinned account; never refreshes tokens or enables billing. */
export async function readClaudeFastModeAccountAvailability(
  launch: Pick<ClaudeStructuredLaunch, 'claudeConfigDir' | 'env'>,
  settings: unknown,
  timeoutMs: number | undefined,
  initialization: unknown
): Promise<AgentSessionFastModeSupport> {
  // A failed settings read cannot exclude project-level auth overrides.
  const account = record(record(initialization)?.account)
  if (!record(settings) || account?.apiProvider !== 'firstParty') {
    return unconfirmedClaudeFastMode()
  }
  const env = { ...launch.env, ...record(record(settings)?.env) }
  const configured = (key: string) => Boolean(text(env[key])?.trim())
  if (env.CLAUDE_CODE_DISABLE_FAST_MODE === '1' || env.CLAUDE_CODE_DISABLE_FAST_MODE === 'true') {
    return { supported: false, reason: 'disabled_by_env' }
  }
  if (
    ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].some(
      (key) => env[key] === '1' || env[key] === 'true'
    ) ||
    configured('ANTHROPIC_AUTH_TOKEN') ||
    (configured('ANTHROPIC_BASE_URL') &&
      text(env.ANTHROPIC_BASE_URL)?.replace(/\/$/, '') !== 'https://api.anthropic.com')
  ) {
    return unconfirmedClaudeFastMode()
  }
  try {
    const usesApiKey = Boolean(text(account.apiKeySource) && account.apiKeySource !== 'none')
    const apiKey = usesApiKey ? text(env.ANTHROPIC_API_KEY) : null
    if (usesApiKey && !apiKey) {
      return unconfirmedClaudeFastMode()
    }
    if (!usesApiKey && (!text(account.tokenSource) || account.tokenSource === 'none')) {
      return unconfirmedClaudeFastMode()
    }
    if (!apiKey && record(record(settings)?.effective)?.apiKeyHelper) {
      return unconfirmedClaudeFastMode()
    }
    const token = apiKey
      ? null
      : (text(env.CLAUDE_CODE_OAUTH_TOKEN) ?? (await accountToken(launch.claudeConfigDir)))
    if (!apiKey && !token) {
      return unconfirmedClaudeFastMode()
    }
    await ensureElectronProxyFromEnvironment({
      proxySession: session.defaultSession,
      probeUrl: AVAILABILITY_URL
    })
    const response = await net.fetch(AVAILABILITY_URL, {
      headers: {
        'User-Agent': 'claude-code/2.1.0',
        ...(apiKey
          ? { 'x-api-key': apiKey }
          : { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' })
      },
      signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs ?? 10_000, 10_000)))
    })
    if (!response.ok) {
      return unconfirmedClaudeFastMode()
    }
    const data = record(await response.json())
    if (data?.enabled === true) {
      return { supported: true, accountVerified: true }
    }
    return data?.enabled === false
      ? { supported: false, reason: text(data.disabled_reason) ?? 'unknown' }
      : unconfirmedClaudeFastMode()
  } catch {
    return unconfirmedClaudeFastMode()
  }
}
