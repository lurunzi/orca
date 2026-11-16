import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'

export type StructuredAgentSessionProviderRenameInput = {
  record: AgentSessionRecord
  providerSessionId: string
  name: string
  signal?: AbortSignal
}
