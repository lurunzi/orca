import type { AiVaultConversationCopy } from '../../../../shared/ai-vault/resume/ai-vault-resume-preparation'
import type { CodexPoolCopyReceipt } from '../../../dashboard-accounts/dashboard-codex-pool-copy'
import type { NativeCopyCoverage } from '../../agent-session-journal/context-epochs/journal-history-origin'

export type StructuredAgentSessionConversationCopyResult = AiVaultConversationCopy & {
  resumeCursor?: string
  coverage?: NativeCopyCoverage
  poolCopy?: CodexPoolCopyReceipt
}
