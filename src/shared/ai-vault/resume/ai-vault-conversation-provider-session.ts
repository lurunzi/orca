import type { AiVaultSession } from '../contracts/ai-vault-types'
import type { AgentProviderSessionMetadata } from '../../agent-session/lifecycle/agent-session-resume'

/** Cursor and Antigravity resume by conversation id; Cursor rows also carry their transcript. */
export function getAiVaultConversationProviderSession(
  session: Pick<AiVaultSession, 'agent' | 'sessionId'> & { filePath?: string }
): AgentProviderSessionMetadata {
  return {
    key: 'conversation_id',
    id: session.sessionId,
    ...(session.agent === 'cursor' && session.filePath ? { transcriptPath: session.filePath } : {})
  }
}
