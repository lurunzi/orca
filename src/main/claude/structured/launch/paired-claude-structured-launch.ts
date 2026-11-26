import type { StructuredAgentLaunchPart } from '../../../runtime/agent-session/launch/structured-agent-launch-composition'
import type { ClaudeStructuredLaunch } from './claude-structured-launch-resolution'
import { CLAUDE_STRUCTURED_BASE_OPTIONS } from './claude-structured-base-options'
import type { PairedClaudeSession } from '../../../dashboard-accounts/paired-claude-session'

export function pairedClaudeLaunch(
  session: PairedClaudeSession,
  fork: boolean
): StructuredAgentLaunchPart<ClaudeStructuredLaunch> {
  if (fork) {
    throw new Error('Paired subscription does not support rewinding a provider transcript')
  }
  return {
    launch: {
      pathToClaudeCodeExecutable: '/usr/local/bin/claude',
      options: {
        ...CLAUDE_STRUCTURED_BASE_OPTIONS,
        settingSources: [],
        permissionMode: 'default',
        ...(session.resume
          ? { resume: session.providerSessionId }
          : { sessionId: session.providerSessionId })
      },
      pairedSubscription: session,
      claudeConfigDir: session.configDir,
      providerSessionId: session.providerSessionId,
      resumeLeafUuid: null,
      resumesTranscript: session.resume,
      cliFlag: async () => 'unknown',
      continuesChain: session.resume
    },
    env: {},
    inheritedEnvToDelete: []
  }
}
