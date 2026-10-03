import path from 'node:path'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'
import { antigravityCommandName } from './antigravity-usage-command'

/** Keep PATH precedence; GUI launchers can omit the CLI's standard installation directory. */
export async function resolveAntigravityCliPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  resolve = resolveCommandOnLocalPath
): Promise<string | null> {
  const options = { env, platform }
  const onPath = await resolve(antigravityCommandName(), options)
  if (onPath) {
    return onPath
  }
  const isWindows = platform === 'win32'
  const root = isWindows
    ? Object.entries(env).find(([key]) => key.toLowerCase() === 'localappdata')?.[1]
    : env.HOME
  const paths = isWindows ? path.win32 : path.posix
  if (!root || !paths.isAbsolute(root)) {
    return null
  }
  const candidate = isWindows
    ? paths.join(root, 'agy', 'bin', 'agy.exe')
    : paths.join(root, '.local', 'bin', 'agy')
  return resolve(candidate, options)
}
