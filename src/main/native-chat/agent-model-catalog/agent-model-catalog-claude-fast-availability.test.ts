import { expect, it, onTestFinished } from 'vitest'
import { agentSessionRecordFixture } from '../agent-session-record-test-fixture'
import { agentSessionConversationView } from '../../../shared/agent-session/lifecycle/agent-session-conversation-view'
import { agentModelCatalogFingerprintForRecord } from './agent-model-catalog-fingerprint'
import { createAgentModelCatalogService } from './agent-model-catalog-service'
import { AgentModelCatalogStore } from './agent-model-catalog-store'

it('never treats a cached Claude capability as current availability', async () => {
  const store = new AgentModelCatalogStore()
  const record = agentSessionRecordFixture({
    sessionId: 'session-1',
    provider: 'claude',
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/homes/claude' },
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'ws-1',
      workspaceKind: 'git-worktree'
    }
  })
  store.recordSuccess(
    agentModelCatalogFingerprintForRecord(record),
    'claude',
    {
      models: [{ id: 'opus', label: 'Opus', isDefault: true, supportsFastMode: true, efforts: [] }],
      origin: 'probe',
      fastModeSupport: { supported: true }
    },
    'discovery'
  )
  const service = createAgentModelCatalogService({
    store,
    getConversation: () => agentSessionConversationView(record),
    getRecord: () => record,
    drivesRecord: () => true,
    resolveAccountHome: async () => record.accountHome,
    recordWorkspacePath: async () => '/workspace',
    agentReadsProjectModelConfig: () => false,
    workspaceMayOverrideDefaultModel: async () => false
  })
  onTestFinished(() => service.stop())

  await expect(service.read({ agent: 'claude', sessionId: 'session-1' })).resolves.toMatchObject({
    models: [expect.objectContaining({ supportsFastMode: true })],
    fastModeSupport: { supported: false, reason: 'availability-unconfirmed' }
  })
})
