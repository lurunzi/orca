import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolvePnpmCliInvocation } from '../../config/scripts/tool-invocation/pnpm-cli-invocation.mjs'

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

export function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024
  })
  const ok = !result.error && result.status === 0
  if (!ok && !allowFailure) {
    const detail = result.error?.message ?? result.stderr.trim()
    throw new Error(`git ${args.join(' ')} failed: ${detail}`)
  }
  return { ok, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

export function runInherited(command, args, { shell = false, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    windowsHide: true,
    shell,
    env
  })
  if (result.error) {
    console.error(result.error.message)
    return 1
  }
  return result.status ?? 1
}

export function pnpmCommand(args) {
  const invocation = resolvePnpmCliInvocation()
  return {
    command: invocation.command,
    args: [...invocation.prefixArgs, ...args],
    shell: invocation.shell,
    display: `pnpm ${args.join(' ')}`
  }
}
