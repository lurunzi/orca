import type { ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import { spawnProcess } from '@orca/process-host'
import { forceTerminateProcessTree } from '@orca/process-host/process-tree-termination'
import type { GitHubHostAuthPrompt } from '../../../shared/github/accounts/github-host-auth'
import { findRunnableLocalCommand } from '../../ipc/preflight/preflight-command-exec'
import { nonInteractiveGitEnv } from '../../git/command-runner/git-environment/git-process-env'
import { ghExecFileAsync } from '../../git/command-runner/hosted-cli/gh-exec-file'
import { withConfiguredProxyEnv } from '../../network/configured-proxy-child-env'
import { runPreflightCheck } from '../../preflight/agent-detection'
import { readViewerLogin } from '../client/fetch/authenticated-viewer'
import {
  GhDeviceLoginError,
  GhDeviceLoginOutput,
  classifyGhLoginFailure
} from './gh-device-login-output'

export const GH_DEVICE_LOGIN_ARGS = [
  'auth',
  'login',
  '--hostname',
  'github.com',
  '--git-protocol',
  'https',
  '--web'
] as const
const PROMPT_TIMEOUT_MS = 30_000
// GitHub device codes live 15 minutes; past that the login cannot finish.
const SESSION_DEADLINE_MS = 15 * 60_000
const LOGGED_IN_AS = /Logged in as ([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/
const MAX_ERROR_CHARS = 600

export type GhDeviceLoginChannel = {
  signal: AbortSignal
  onPrompt: (prompt: GitHubHostAuthPrompt) => void
}

export type GhDeviceLoginOptions = {
  promptTimeoutMs?: number
  deadlineMs?: number
  /** Runs once gh exits 0; returns the signed-in login. */
  afterSignIn?: (output: string) => Promise<string | null>
  env?: NodeJS.ProcessEnv
  /** A gh to run instead of the one the status check finds (local proofs with a fake gh). */
  binary?: string
}

/** gh must neither prompt nor open a browser here: the person approves on their own device. */
export function ghDeviceLoginEnv(
  base: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const noBrowser = platform === 'win32' ? 'cmd /c rem' : 'true'
  return {
    ...nonInteractiveGitEnv(withConfiguredProxyEnv(base) ?? base, platform),
    GH_PROMPT_DISABLED: '1',
    GH_TELEMETRY: 'false',
    GH_BROWSER: noBrowser,
    BROWSER: noBrowser
  }
}

/** Runs `gh auth login --web` on this host; the token is written by gh here and never leaves it. */
export async function runGhHostDeviceLogin(
  channel: GhDeviceLoginChannel,
  options: GhDeviceLoginOptions = {}
): Promise<{ login: string | null }> {
  if (channel.signal.aborted) {
    throw new Error('GitHub sign-in was cancelled.')
  }
  // The copy the gh status check verified, so a dead PATH shim cannot run instead.
  const gh = options.binary
    ? { status: 'available' as const, binary: options.binary }
    : await findRunnableLocalCommand('gh')
  if (gh.status !== 'available') {
    throw new GhDeviceLoginError(gh.status === 'absent' ? 'notInstalled' : null)
  }
  if (channel.signal.aborted) {
    throw new Error('GitHub sign-in was cancelled.')
  }
  const child: ChildProcess = spawnProcess({
    program: gh.binary,
    args: [...GH_DEVICE_LOGIN_ARGS],
    env: ghDeviceLoginEnv(options.env),
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own POSIX group, so cancel ends gh and anything it started.
    detached: process.platform !== 'win32'
  })
  const spawnErrors: NodeJS.ErrnoException[] = []
  const exited = new Promise<number | null>((resolve) => {
    child.once('error', (error: NodeJS.ErrnoException) => {
      spawnErrors.push(error)
      resolve(null)
    })
    child.once('close', (code) => resolve(code))
  })
  const streams = [child.stdout, child.stderr].filter((s): s is Readable => s !== null)
  const output = new GhDeviceLoginOutput(streams, options.promptTimeoutMs ?? PROMPT_TIMEOUT_MS)
  let expired = false
  const kill = (): void => {
    void forceTerminateProcessTree(child).catch(() => false)
  }
  channel.signal.addEventListener('abort', kill, { once: true })
  const deadline = setTimeout(() => {
    expired = true
    kill()
  }, options.deadlineMs ?? SESSION_DEADLINE_MS)
  try {
    try {
      channel.onPrompt(await output.promptReady)
    } catch (error) {
      kill()
      await exited
      throw startFailure(error, spawnErrors[0] ?? null, output.redactedText())
    }
    const code = await exited
    if (channel.signal.aborted) {
      throw new Error('GitHub sign-in was cancelled.')
    }
    if (expired) {
      throw new GhDeviceLoginError('expired')
    }
    const text = output.redactedText()
    if (code !== 0) {
      throw new GhDeviceLoginError(classifyGhLoginFailure(text), failureText(text, code))
    }
    return { login: await (options.afterSignIn ?? finishGhHostSignIn)(text) }
  } finally {
    clearTimeout(deadline)
    channel.signal.removeEventListener('abort', kill)
    output.dispose()
  }
}

function startFailure(
  error: unknown,
  spawnError: NodeJS.ErrnoException | null,
  text: string
): unknown {
  if (spawnError) {
    return spawnError.code === 'ENOENT'
      ? new GhDeviceLoginError('notInstalled')
      : new GhDeviceLoginError(null, `Could not start gh: ${spawnError.message}`)
  }
  // gh ended without a code but said why (an old gh, a bad flag): show its words.
  const said = failureText(text, null)
  return error instanceof GhDeviceLoginError && error.code === 'noCode' && said && text.trim()
    ? new GhDeviceLoginError(null, said)
    : error
}

function failureText(text: string, code: number | null): string | undefined {
  if (classifyGhLoginFailure(text)) {
    return undefined
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/one-time code|Open this URL/i.test(line))
  const message = lines.slice(-3).join(' ') || `gh exited with code ${code ?? 'unknown'}.`
  return message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}…` : message
}

/** Non-interactive gh skips its git credential setup, so run it, then refresh the host's gh status. */
async function finishGhHostSignIn(output: string): Promise<string | null> {
  await ghExecFileAsync(['auth', 'setup-git', '--hostname', 'github.com']).catch(() => undefined)
  await runPreflightCheck(true).catch(() => undefined)
  return LOGGED_IN_AS.exec(output)?.[1] ?? (await readViewerLogin({}))
}
