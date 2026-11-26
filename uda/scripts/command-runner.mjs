import { spawn, spawnSync } from 'node:child_process'
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

export function runCaptured(command, args, { env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env,
    maxBuffer: 64 * 1024 * 1024
  })
  return {
    status: result.error ? 1 : (result.status ?? 1),
    stdout: result.stdout ?? '',
    stderr: result.error ? result.error.message : (result.stderr ?? '')
  }
}

/** Runs `command` with stdout/stderr inherited and `input` (an async iterable of Buffers) as stdin. */
export function runWithStdin(command, args, input) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'inherit', 'inherit'],
      windowsHide: true
    })
    let failure = null
    let closed = false
    let wake = () => {}
    child.stdin.on('error', () => {})
    child.stdin.on('drain', () => wake())
    child.on('error', (error) => {
      failure = error
    })
    child.on('close', (code) => {
      closed = true
      wake()
      if (failure) {
        console.error(failure.message)
      }
      resolve(failure ? 1 : (code ?? 1))
    })
    ;(async () => {
      try {
        for await (const chunk of input) {
          if (closed || child.stdin.destroyed) {
            break
          }
          if (!child.stdin.write(chunk)) {
            await new Promise((done) => {
              wake = done
              if (closed) {
                done()
              }
            })
          }
        }
      } catch (error) {
        failure = error
        child.kill()
      } finally {
        child.stdin.end()
      }
    })()
  })
}
