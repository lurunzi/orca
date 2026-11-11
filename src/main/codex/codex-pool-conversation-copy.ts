import type { CodexPoolIdentity } from '../../shared/agent-session/lifecycle/agent-session-pool-account'
import {
  DashboardAllocationError,
  DashboardToolProvider
} from '../dashboard-accounts/dashboard-allocation-protocol'
import { CodexPoolCopyReceiptSchema } from '../dashboard-accounts/dashboard-codex-pool-copy'
import { DashboardCodexRefreshOperation } from '../dashboard-accounts/dashboard-codex-refresh-protocol'
import type { StructuredAgentSessionConversationCopyInput } from '../native-chat/agent-session-wire/providers/structured-agent-session-conversation-copy-input'
import type { StructuredAgentSessionConversationCopyResult } from '../native-chat/agent-session-wire/providers/structured-agent-session-conversation-copy-result'
import { copyCodexConversation } from './codex-conversation-copy'
import {
  isCodexPoolRecord,
  runCodexPoolProviderAppServer
} from './structured/session-lifecycle/codex-pool-provider-invocation'
import type { CodexProviderInvocationDeps } from './structured/session-lifecycle/codex-provider-session-rename'
import type { CodexShortLivedOperations } from './structured/session-lifecycle/codex-short-lived-operations'

/** Pool copies authenticate their short-lived app-server and return a same-operation receipt. */
export async function copyCodexConversationForAccount(
  input: StructuredAgentSessionConversationCopyInput,
  invocation: CodexProviderInvocationDeps | undefined,
  owner: CodexShortLivedOperations
): Promise<StructuredAgentSessionConversationCopyResult> {
  const { record } = input
  if (!isCodexPoolRecord(record)) {
    return copyCodexConversation(input, invocation)
  }
  if (!record) {
    throw new DashboardAllocationError()
  }
  return owner.track(input.signal, async (signal) => {
    const pool: { identity: CodexPoolIdentity | null } = { identity: null }
    const { sessionId } = await copyCodexConversation(
      { ...input, signal },
      invocation,
      (source, launch, options, body) =>
        runCodexPoolProviderAppServer(
          owner,
          source,
          launch,
          { ...options, operation: DashboardCodexRefreshOperation.CopyConversation },
          async (rpc, cwd, authenticated) => {
            const result = await body(rpc, cwd)
            pool.identity = authenticated
            return result
          }
        )
    )
    const { identity } = pool
    if (!identity) {
      return { sessionId }
    }
    const poolCopy = CodexPoolCopyReceiptSchema.parse({
      provider: DashboardToolProvider.Codex,
      sourceSessionId: record.sessionId,
      sourceProviderSessionId: input.providerSessionId,
      targetProviderSessionId: sessionId,
      identity
    })
    return { sessionId, poolCopy }
  })
}
