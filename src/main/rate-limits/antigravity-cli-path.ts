import path from 'node:path'
import { resolveCommandOnLocalPath } from '../ipc/command-path/command-path-resolver'
import { antigravityCommandName } from './providers/antigravity/antigravity-usage-command'
import {
  resolveAntigravityHostProgram,
  type AntigravityHostProgram,
  type AntigravityHostProgramOptions
} from './providers/antigravity/antigravity-usage-host-program'

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

/** The host usage probe's agy, also found in its standard install folder a GUI PATH can omit. */
export function resolveAgyHostProgram(
  command: string,
  options: AntigravityHostProgramOptions
): Promise<AntigravityHostProgram> {
  return resolveAntigravityHostProgram(command, {
    ...options,
    resolveCommand: () =>
      resolveAntigravityCliPath(options.env, options.platform, options.resolveCommand)
  })
}
