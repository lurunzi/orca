import type { Readable } from 'node:stream'
import { stripAnsiEscapeSequences } from '../../../shared/terminal/protocol/escape/ansi-escape-sequences'
import {
  GITHUB_HOST_AUTH_FAILURE_COPY,
  isGitHubDeviceLoginPage,
  type GitHubHostAuthFailureCode,
  type GitHubHostAuthPrompt
} from '../../../shared/github/accounts/github-host-auth'

const ONE_TIME_CODE = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})(?![A-Z0-9])/
const ANY_DEVICE_CODE = /(?<![A-Z0-9])[A-Z0-9]{4}-[A-Z0-9]{4}(?![A-Z0-9])/g
const HTTPS_URL = /https:\/\/[^\s"'<>]+/g
const MAX_OUTPUT_CHARS = 8_192

/** The code and page from `gh auth login --web` output; both must be present. */
export function parseGhDeviceLoginPrompt(text: string): GitHubHostAuthPrompt | null {
  const plain = stripAnsiEscapeSequences(text)
  const code = ONE_TIME_CODE.exec(plain)?.[1]
  if (!code) {
    return null
  }
  const verificationUri = plain
    .match(HTTPS_URL)
    ?.map((url) => url.replace(/[.,;:)]+$/, ''))
    .find(isGitHubDeviceLoginPage)
  return verificationUri ? { userCode: code, verificationUri } : null
}

/** gh output with every device code masked, so it can go into errors and logs. */
export function redactGhDeviceCodes(text: string): string {
  return stripAnsiEscapeSequences(text).replace(ANY_DEVICE_CODE, '****-****')
}

/** Orca's own name for a gh login failure, or null when only gh's text explains it. */
export function classifyGhLoginFailure(output: string): GitHubHostAuthFailureCode | null {
  if (/(GH_TOKEN|GITHUB_TOKEN)[^\n]*environment variable is being used/i.test(output)) {
    return 'envToken'
  }
  if (/expired_token|(code|token)[^\n]*expired/i.test(output)) {
    return 'expired'
  }
  if (/access_denied|denied/i.test(output)) {
    return 'denied'
  }
  return null
}

export class GhDeviceLoginError extends Error {
  constructor(
    readonly code: GitHubHostAuthFailureCode | null,
    message = code ? GITHUB_HOST_AUTH_FAILURE_COPY[code] : 'GitHub sign-in failed.'
  ) {
    super(message)
  }
}

/** Reads gh's streams until the device prompt appears; keeps a code-free tail for failure text. */
export class GhDeviceLoginOutput {
  private text = ''
  private settled = false
  private readonly prompt = Promise.withResolvers<GitHubHostAuthPrompt>()
  private readonly timer: ReturnType<typeof setTimeout>

  constructor(streams: readonly Readable[], timeoutMs: number) {
    this.prompt.promise.catch(() => {})
    this.timer = setTimeout(() => this.fail(new GhDeviceLoginError('promptTimeout')), timeoutMs)
    let open = streams.length
    for (const stream of streams) {
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => this.append(chunk))
      stream.once('close', () => {
        open -= 1
        if (open === 0) {
          this.fail(new GhDeviceLoginError(classifyGhLoginFailure(this.text) ?? 'noCode'))
        }
      })
    }
  }

  /** Resolves with the first complete prompt; rejects on timeout or when gh ends without one. */
  get promptReady(): Promise<GitHubHostAuthPrompt> {
    return this.prompt.promise
  }

  /** What gh printed, codes masked. */
  redactedText(): string {
    return redactGhDeviceCodes(this.text)
  }

  dispose(): void {
    clearTimeout(this.timer)
    this.settled = true
  }

  private append(chunk: string): void {
    this.text = `${this.text}${chunk}`.slice(-MAX_OUTPUT_CHARS)
    if (this.settled) {
      return
    }
    const prompt = parseGhDeviceLoginPrompt(this.text)
    if (prompt) {
      this.settled = true
      clearTimeout(this.timer)
      this.prompt.resolve(prompt)
    }
  }

  private fail(error: GhDeviceLoginError): void {
    if (this.settled) {
      return
    }
    this.settled = true
    clearTimeout(this.timer)
    this.prompt.reject(error)
  }
}
