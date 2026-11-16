import { agentSessionRecordFixture } from '../../../shared/agent-session/lifecycle/records/agent-session-record.test-fixture'
import { afterEach, expect, it, vi } from 'vitest'
import { codexProviderHandle } from '../../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle-encoding'
import { DashboardToolProvider } from '../../../shared/dashboard-account-provider'
import type { CodexPoolCopyReceipt } from '../../dashboard-accounts/dashboard-codex-pool-copy'
import { setStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { copyStructuredChatRecordConversation } from './structured-chat-conversation-copy'
import { installCopyingChat as installChat } from './structured-session-ownership.test-support'

afterEach(() => setStructuredAgentSessionHost(null))

it('publishes only public copy fields when the adapter returns a pool receipt', async () => {
  const poolCopy: CodexPoolCopyReceipt = {
    provider: DashboardToolProvider.Codex,
    sourceSessionId: 'chat-1',
    sourceProviderSessionId: 'source-thread',
    targetProviderSessionId: 'copied-thread',
    identity: {
      instanceId: 'instance-1',
      provider: DashboardToolProvider.Codex,
      accountId: 'account-1',
      bindingRevision: 1,
      credentialVersion: 1
    }
  }
  const copy = vi.fn(async () => ({
    sessionId: 'copied-thread',
    filePath: '/sessions/copied-thread.jsonl',
    poolCopy
  }))
  installChat(codexProviderHandle('source-thread'), copy)

  await expect(
    copyStructuredChatRecordConversation(
      { ...agentSessionRecordFixture(), sessionId: 'chat-1' },
      'source-thread'
    )
  ).resolves.toStrictEqual({
    useRealCodexHome: false,
    forkedSession: {
      sessionId: 'copied-thread',
      filePath: '/sessions/copied-thread.jsonl',
      agent: DashboardToolProvider.Codex
    }
  })
})
