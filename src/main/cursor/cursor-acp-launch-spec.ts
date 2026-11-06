import { join } from 'node:path'
import type { AcpLaunchSpec } from '../acp/acp-launch-specs'
import { directoryAccountBinding } from '../acp/acp-account-binding'
import { CURSOR_ACP_DIALECT } from '../acp/acp-dialects/cursor-dialect'
import { readCursorModelCatalog } from '../acp/acp-dialects/cursor-model-catalog'
import { agentSessionSignInFor } from '../../shared/agent-session/lifecycle/agent-session-sign-in'
import type { StructuredAgentSessionHistory } from '../native-chat/structured-agent-cli-conversations'

// ACP chats live in <config>/acp-sessions; terminal `--resume` reads <config>/chats, so neither resumes the other.
const CURSOR_ACP_SESSION_HISTORY: StructuredAgentSessionHistory = {
  rowAgents: ['cursor'],
  rowSessionId: (link) => link.handle.nativeId,
  parseResumeArgs: () => null
}

/** cursor-agent runs hook commands through $SHELL; Orca's Windows hooks are PowerShell, so a
 *  Git Bash SHELL makes every hook fail and blocks every tool call. */
export function scrubCursorAcpEnvironment(
  env: Record<string, string>,
  inherited: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform !== 'win32' || (env.SHELL === undefined && inherited.SHELL === undefined)) {
    return []
  }
  delete env.SHELL
  return ['SHELL']
}

export const CURSOR_LAUNCH_SPEC = {
  agent: 'cursor',
  command: 'cursor-agent',
  // No --force: Orca answers each permission request, approving them under Full access.
  args: () => ['acp'],
  env: {},
  scrubEnvironment: scrubCursorAcpEnvironment,
  dialect: CURSOR_ACP_DIALECT,
  loginCommand: agentSessionSignInFor('cursor')?.loginCommand ?? [],
  // Reuses the existing `cursor-agent login`; never starts an interactive sign-in.
  authMethod: ({ advertised }) =>
    advertised.includes('cursor_login') ? 'cursor_login' : undefined,
  account: directoryAccountBinding('CURSOR_CONFIG_DIR', (homePath) => join(homePath, '.cursor')),
  // The installer's folders, for hosts whose PATH snapshot predates the install.
  installDirectories: ({ env, homePath }) =>
    process.platform === 'win32'
      ? [join(env.LOCALAPPDATA ?? join(homePath, 'AppData', 'Local'), 'cursor-agent')]
      : [join(homePath, '.local', 'bin')],
  modelDiscovery: {
    kind: 'initialize',
    read: readCursorModelCatalog,
    listingNamesConfiguredModel: false
  },
  transcriptImport: null,
  sessionHistory: CURSOR_ACP_SESSION_HISTORY,
  // Base model ids plus per-model effort options, instead of one fixed variant id per model.
  clientCapabilitiesMeta: { parameterizedModelPicker: true }
} satisfies AcpLaunchSpec
