// Hosts without a managed Antigravity build run the installed agy CLI's own ACP server, which
// shares the CLI's sign-in and conversations.

import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import {
  readAgentCliVersion,
  type AgentCliVersionInput,
  type AgentCliVersionReader
} from '../agent-launch/preflight/agent-cli-version-probe'
import { directoryAccountBinding, type AcpAccountBinding } from '../acp/launch/acp-account-binding'
import type { AcpLaunchSpec } from '../acp/launch/acp-launch-contract'

// 1.5.2 is the first release verified with Orca chats; it also leaves the chat's folder untouched.
const AGY_ACP_MINIMUM_VERSIONS = ['1.5.2'] as const
const ACP_SUBCOMMAND = /^\s+acp\s+.*Agent Client Protocol/m
const FAILED_CHECK_RETRY_MS = 5 * 60_000

type AgyAcpProbeDeps = {
  readVersion: AgentCliVersionReader
  run: typeof runProcess
  identify?: (program: string) => Promise<string | null>
  now?: () => number
}
type AgyAcpCheck = {
  identity: string
  release: ReturnType<AgentCliVersionReader>
  retryAt?: number
}
const checks = new Map<string, AgyAcpCheck>()

async function binaryIdentity(program: string): Promise<string | null> {
  const stats = await stat(program).catch(() => null)
  return stats?.isFile() ? `${stats.size}:${stats.mtimeMs}` : null
}

/** An agy whose `--help` lists no `acp` server (or another program named agy) has no chat program. */
export async function readAgyAcpRelease(
  input: AgentCliVersionInput,
  deps: AgyAcpProbeDeps = { readVersion: readAgentCliVersion, run: runProcess }
): ReturnType<AgentCliVersionReader> {
  const now = deps.now ?? Date.now
  // Keyed by the binary's identity so an upgrade or reinstall is checked again.
  const identity = await (deps.identify ?? binaryIdentity)(input.program)
  const cached = identity === null ? undefined : checks.get(input.program)
  if (cached?.identity === identity && (cached.retryAt === undefined || now() < cached.retryAt)) {
    return cached.release
  }
  const check: AgyAcpCheck = { identity: identity ?? '', release: probeAgyAcp(input, deps) }
  if (identity !== null) {
    checks.set(input.program, check)
  }
  const release = await check.release
  if (release.version === null) {
    // A hung or broken agy must not delay every chat start and availability read.
    check.retryAt = now() + FAILED_CHECK_RETRY_MS
  }
  return release
}

async function probeAgyAcp(
  input: AgentCliVersionInput,
  deps: AgyAcpProbeDeps
): ReturnType<AgentCliVersionReader> {
  const release = await deps.readVersion(input)
  if (release.version === null) {
    return release
  }
  const { prefixArgs = [], ...launch } = input
  const help = await deps
    .run({
      ...launch,
      args: [...prefixArgs, '--help'],
      terminationBarrier: true,
      timeoutMs: 5_000,
      maxOutputBytes: 16_384,
      killOnOutputLimit: true
    })
    .catch(() => null)
  const listsAcp = help !== null && !help.timedOut && ACP_SUBCOMMAND.test(help.stdout + help.stderr)
  if (!listsAcp) {
    console.warn(`[antigravity] ${input.program} --help lists no ACP server`)
  }
  return listsAcp ? release : { version: null, started: false }
}

export function resetAgyAcpChecksForTests(): void {
  checks.clear()
}

// agy ignores GEMINI_HOME and keeps its own home and credential store; the pin only names the account.
function agyCliAccount(): AcpAccountBinding {
  const binding = directoryAccountBinding('GEMINI_HOME', (homePath) => join(homePath, '.gemini'))
  return {
    ...binding,
    environment: (home, env) => {
      binding.environment(home, env)
      return env
    }
  }
}

// An inherited Gemini API key switches agy to key auth, which its models reject (401).
function scrubAgyApiKeys(env: Record<string, string>): string[] {
  const removed = ['GEMINI_API_KEY', 'GOOGLE_API_KEY']
  for (const key of removed) {
    delete env[key]
  }
  return removed
}

export function antigravityCliLaunchSpec(managed: AcpLaunchSpec): AcpLaunchSpec {
  return {
    agent: managed.agent,
    command: 'agy',
    args: () => ['acp'],
    env: {},
    scrubEnvironment: scrubAgyApiKeys,
    // A signed-out chat points at agy's own sign-in, not Orca's Antigravity account.
    dialect: { ...managed.dialect, signInAccount: 'system' },
    loginCommand: managed.loginCommand,
    // No authMethod or sign-in reader: Orca neither signs agy in or out nor records its auth as Orca's own.
    account: agyCliAccount(),
    minimumVersions: AGY_ACP_MINIMUM_VERSIONS,
    readVersion: readAgyAcpRelease,
    // The Windows installer's folder and the POSIX one, for Orca started before agy joined PATH.
    installDirectories: ({ env, homePath }) => [
      ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'agy', 'bin')] : []),
      join(homePath, '.local', 'bin')
    ],
    // No yolo mode: Orca answers approvals under Full access, except questions and warned reviews.
    permissionModeConfig: { values: { ask: 'default', 'accept-edits': 'accept-edits' } },
    modelDiscovery: managed.modelDiscovery,
    transcriptImport: null,
    sessionHistory: managed.sessionHistory,
    resumePreference: 'resume',
    keepsEverySession: true
  }
}
