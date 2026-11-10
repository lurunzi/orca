import { DashboardAllocationError } from '../../../dashboard-accounts/dashboard-allocation-protocol'
import { DashboardCodexRefreshOperation } from '../../../dashboard-accounts/dashboard-codex-refresh-protocol'
import type { StructuredAgentSessionAdapter } from '../../../native-chat/agent-session-wire/providers/structured-agent-session-adapter'
import { isCodexPoolRecord, runCodexPoolProviderAppServer } from './codex-pool-provider-invocation'
import type { CodexProviderInvocationDeps } from './codex-provider-session-rename'
import { readCodexSessionAccountUsage, readUsage } from './codex-session-account-usage'
import type { CodexShortLivedOperations } from './codex-short-lived-operations'
import type { CodexSession } from './codex-structured-session-state'

const COLD_USAGE_TIMEOUT_MS = 30_000

/** Pool chats read only on an adopted connection or an authenticated short-lived app-server. */
export function readCodexSessionAccountUsageForAccount(
  sessions: Map<string, CodexSession>,
  readInvocation: () => CodexProviderInvocationDeps | undefined,
  owner: CodexShortLivedOperations
): NonNullable<StructuredAgentSessionAdapter['readAccountUsage']> {
  const personal = readCodexSessionAccountUsage(sessions, readInvocation)
  return async (record, signal) => {
    const session = sessions.get(record.sessionId)
    const adopted = session?.dashboardAdoption !== undefined
    if (!isCodexPoolRecord(record) && !adopted) {
      return personal(record, signal)
    }
    const connection = session?.connection
    if (session && connection && !connection.closed) {
      const assertCurrent = (): void => {
        if (
          !adopted ||
          session.ended ||
          connection.closed ||
          sessions.get(record.sessionId) !== session
        ) {
          throw new DashboardAllocationError()
        }
      }
      assertCurrent()
      const usage = await readUsage((method, params, options) =>
        connection.request(method, params, options)
      )
      assertCurrent()
      return { ...usage, live: true, pool: true }
    }
    const invocation = readInvocation()
    if (!invocation) {
      throw new Error('Codex usage invocation is not configured')
    }
    return runCodexPoolProviderAppServer(
      owner,
      record,
      invocation,
      {
        timeoutMs: COLD_USAGE_TIMEOUT_MS,
        signal,
        operation: DashboardCodexRefreshOperation.ReadAccountUsage,
        serializeHome: true
      },
      async (rpc, _cwd, identity) => ({
        ...(await readUsage(rpc.request)),
        ...(identity ? { pool: true as const } : {})
      })
    )
  }
}
