import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { getRequiredStringFlag, getRequiredStringFlagAllowingEmpty } from './flags'
import { looksLikeGbkDecodedUtf8 } from './garbled-utf8-text'
import { RuntimeClientError } from './runtime-client'

type BodyOptions = {
  required: boolean
  maximumCharacters: number
  tooLargeCode: string
  label: string
}

export function readCommandBody(
  flags: Map<string, string | boolean>,
  cwd: string,
  options: BodyOptions & { required: true }
): Promise<string>
export function readCommandBody(
  flags: Map<string, string | boolean>,
  cwd: string,
  options: BodyOptions
): Promise<string | undefined>
export async function readCommandBody(
  flags: Map<string, string | boolean>,
  cwd: string,
  options: BodyOptions
): Promise<string | undefined> {
  const body = await readTextOrFileFlag(flags, cwd, 'body', options.required)
  if (body !== undefined && body.length > options.maximumCharacters) {
    throw new RuntimeClientError(
      options.tooLargeCode,
      `${options.label} must be at most ${options.maximumCharacters} characters`
    )
  }
  return body
}

/** Reads `--<flag> <text>` or `--<flag>-file <path|->`, refusing both. */
export async function readTextOrFileFlag(
  flags: Map<string, string | boolean>,
  cwd: string,
  flag: string,
  required: boolean
): Promise<string | undefined> {
  const fileFlag = `${flag}-file`
  const hasText = flags.has(flag)
  const hasFile = flags.has(fileFlag)
  if (hasText && hasFile) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Use either --${flag} or --${fileFlag}, not both`
    )
  }
  if (!hasText && !hasFile) {
    if (required) {
      throw new RuntimeClientError('invalid_argument', `Missing --${flag} or --${fileFlag}`)
    }
    return undefined
  }
  if (hasText) {
    return refuseGarbled(getRequiredStringFlagAllowingEmpty(flags, flag), `--${flag}`, fileFlag)
  }
  const path = getRequiredStringFlag(flags, fileFlag)
  const text = await readBodyFile(path, cwd)
  // A named file is read as UTF-8 here, so only the shell-piped stdin path can
  // arrive already garbled; a file may legitimately quote garbled text.
  return path === '-' ? refuseGarbled(text, `--${fileFlag} -`, fileFlag) : text
}

function refuseGarbled(text: string, source: string, fileFlag: string): string {
  if (looksLikeGbkDecodedUtf8(text)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `${source} looks garbled: UTF-8 text was decoded in the Windows ANSI code page before ` +
        `reaching Orca (for example Windows PowerShell 5.1 Get-Content without -Encoding UTF8). ` +
        `Write the text to a UTF-8 file and pass --${fileFlag} <path>; Orca reads that file as UTF-8.`
    )
  }
  return text
}

async function readBodyFile(path: string, cwd: string): Promise<string> {
  if (path !== '-') {
    return readFile(isAbsolute(path) ? path : join(cwd, path), 'utf8')
  }
  if (process.stdin.isTTY) {
    throw new RuntimeClientError('invalid_argument', 'stdin body requested but stdin is a TTY')
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}
