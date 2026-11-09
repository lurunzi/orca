import { buildClaudeChildProcessEnv } from './claude-child-process-environment'
import { withoutInheritedClaudeConfigDir } from './claude-config-dir-pin'
import { withoutRejectedClaudeApiKey } from './claude-rejected-api-key'

function withoutKeys(env: Record<string, string>, keys: readonly string[]): Record<string, string> {
  for (const key of keys) {
    delete env[key]
  }
  return env
}

/** Always scrubbed to prevent ambient auth leaks; only launch.env may pin CLAUDE_CONFIG_DIR. */
export function claudeStreamJsonChildEnv(launch: {
  env?: Record<string, string>
  envToDelete?: readonly string[]
}): ReturnType<typeof withoutRejectedClaudeApiKey> {
  return withoutRejectedClaudeApiKey(
    withoutKeys(
      buildClaudeChildProcessEnv(launch.env, {
        inheritedEnv: withoutInheritedClaudeConfigDir(process.env),
        scrubConfiguredChildSessionStamps: true
      }),
      launch.envToDelete ?? []
    )
  )
}
