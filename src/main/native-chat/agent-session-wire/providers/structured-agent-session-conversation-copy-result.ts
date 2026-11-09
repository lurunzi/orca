import type { AiVaultConversationCopy } from '../../../../shared/ai-vault/resume/ai-vault-resume-preparation'
import type { CodexPoolCopyReceipt } from '../../../dashboard-accounts/dashboard-codex-pool-copy'

export type StructuredAgentSessionConversationCopyResult = AiVaultConversationCopy & {
  poolCopy?: CodexPoolCopyReceipt
}
