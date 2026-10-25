import { agentSessionFailureFact, providerDiagnosticOf } from '../../shared/agent-session-failure'
import type {
  AgentSessionCommandAdmission,
  StructuredAgentSessionCommandRun
} from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { isCodexAppServerRequestError } from './app-server/codex-app-server-request-error'
import type { CodexSession } from './codex-structured-session-state'
import { codexDispatchRejection } from './codex-structured-turn-end-settlement'

/** The reply acknowledges receipt; the translator observes turn completion separately. */
export async function startCodexCompaction(
  session: CodexSession,
  command: StructuredAgentSessionCommandRun,
  timeoutMs: number | undefined
): Promise<AgentSessionCommandAdmission> {
  session.translator?.beginCommand(command)
  try {
    await session.connection.request(
      'thread/compact/start',
      { threadId: session.threadId },
      { timeoutMs }
    )
    return { state: 'accepted', providerIdentity: null }
  } catch (error) {
    session.translator?.forgetCommand(command.turnId)
    if (isCodexAppServerRequestError(error)) {
      return {
        state: 'rejected',
        ...codexDispatchRejection(
          agentSessionFailureFact('providerRejected', { detail: providerDiagnosticOf(error) })
        )
      }
    }
    throw error
  }
}
