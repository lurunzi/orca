import { randomUUID } from 'node:crypto'
import { DashboardToolProvider } from './dashboard-allocation-protocol'
import type { DashboardCodexBinding } from './dashboard-codex-adoption-protocol'
import {
  DashboardCodexRefreshRequestSchema,
  DashboardCodexRefreshScopeSchema,
  type DashboardCodexRefreshRequest,
  type DashboardCodexRefreshScope,
  type DashboardCodexRefreshState
} from './dashboard-codex-refresh-protocol'

export class DashboardCodexRefreshMailbox {
  private readonly entries = new Map<
    string,
    {
      request: DashboardCodexRefreshRequest
      current: () => boolean
    }
  >()

  register(
    scope: DashboardCodexRefreshScope,
    binding: DashboardCodexBinding,
    deadline: number,
    current: () => boolean
  ): () => void {
    const captured = DashboardCodexRefreshScopeSchema.parse(scope)
    const request = DashboardCodexRefreshRequestSchema.parse({
      ...captured,
      process: { ...captured.process },
      account_id: binding.account_id,
      binding_revision: binding.binding_revision,
      credential_version: binding.credential_version,
      provider: DashboardToolProvider.Codex,
      request_id: randomUUID(),
      deadline_at: deadline
    })
    this.entries.set(request.request_id, { request, current })
    return () => {
      this.entries.delete(request.request_id)
    }
  }

  read(): DashboardCodexRefreshState {
    const requests: DashboardCodexRefreshRequest[] = []
    const now = Date.now()
    for (const [id, entry] of this.entries) {
      if (entry.request.deadline_at <= now || !entry.current()) {
        this.entries.delete(id)
        continue
      }
      requests.push({ ...entry.request, process: { ...entry.request.process } })
    }
    return { requests }
  }
}
