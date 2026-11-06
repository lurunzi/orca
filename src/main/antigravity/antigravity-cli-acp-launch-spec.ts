// Hosts without a managed Antigravity build run the installed agy CLI's own ACP server, which
// shares the CLI's sign-in and conversations.

import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import {
  readAgentCliVersion,
  type AgentCliVersionInput,
  type AgentCliVersionReader
} from '../agent-cli-version-probe'
import { directoryAccountBinding, type AcpAccountBinding } from '../acp/acp-account-binding'
import type { AcpLaunchSpec } from '../acp/acp-launch-specs'

// agy 1.5.0 added `agy acp`; 1.5.1 stopped updates arriving after a prompt's reply and hung cancels.
const AGY_ACP_MINIMUM_VERSIONS = ['1.5.1'] as const
const ACP_SUBCOMMAND = /^\s+acp\s+.*Agent Client Protocol/m

type AgyAcpProbeDeps = { readVersion: AgentCliVersionReader; run: typeof runProcess }

/** An agy whose `--help` lists no `acp` server (or another program named agy) has no chat program. */
export async function readAgyAcpRelease(
  input: AgentCliVersionInput,
  deps: AgyAcpProbeDeps = { readVersion: readAgentCliVersion, run: runProcess }
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

export function antigravityCliLaunchSpec(managed: AcpLaunchSpec): AcpLaunchSpec {
  return {
    agent: managed.agent,
    command: 'agy',
    args: () => ['acp'],
    env: {},
    dialect: managed.dialect,
    loginCommand: managed.loginCommand,
    // No authMethod: signing in from a chat would change the terminal agy's account.
    ...(managed.signIn ? { signIn: managed.signIn } : {}),
    account: agyCliAccount(),
    minimumVersions: AGY_ACP_MINIMUM_VERSIONS,
    readVersion: readAgyAcpRelease,
    // The Windows installer's folder, for Orca started before agy joined PATH.
    installDirectories: ({ env }) =>
      env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'agy', 'bin')] : [],
    // No yolo mode: Orca answers approvals under Full access, except questions and warned reviews.
    permissionModeConfig: { values: { ask: 'default', 'accept-edits': 'accept-edits' } },
    modelDiscovery: managed.modelDiscovery,
    transcriptImport: null,
    sessionHistory: managed.sessionHistory,
    resumePreference: 'resume'
  }
}
