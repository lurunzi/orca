import { waitForPromiseWithSignal } from '../../../../shared/abort-signal-reason'
import { isNativeLocalLocation as supportsCodexStructuredLocation } from '../../../../shared/execution-host'
import { DashboardAllocationError } from '../../../dashboard-accounts/dashboard-allocation-protocol'
import { DashboardCodexRefreshOperation } from '../../../dashboard-accounts/dashboard-codex-refresh-protocol'
import { agentDrivesSession } from '../../../native-chat/agent-session-wire/providers/structured-agent-session-provider-support'
import type { StructuredAgentSessionProviderRenameInput } from '../../../native-chat/agent-session-wire/providers/structured-agent-session-provider-rename-input'
import { CODEX_STRUCTURED_AGENT } from '../launch/codex-structured-agent-definition'
import { isCodexPoolRecord, runCodexPoolProviderAppServer } from './codex-pool-provider-invocation'
import {
  renameCodexProviderSession,
  type CodexProviderInvocationDeps
} from './codex-provider-session-rename'
import type { CodexShortLivedOperations } from './codex-short-lived-operations'
import type { CodexSession } from './codex-structured-session-state'

const RENAME_TIMEOUT_MS = 30_000

/** Pool renames never retry or leak provider errors; a cold one runs only after authentication. */
export async function renameCodexProviderSessionForAccount(
  input: StructuredAgentSessionProviderRenameInput & {
    session: CodexSession | undefined
    invocation?: CodexProviderInvocationDeps
    owner: CodexShortLivedOperations
  }
): Promise<void> {
  const { session, record, providerSessionId, name, signal, invocation } = input
  if (!isCodexPoolRecord(record) && !session?.dashboardAdoption) {
    return renameCodexProviderSession(input)
  }
  try {
    signal?.throwIfAborted()
    const live = session && !session.ended && !session.connection.closed ? session : null
    if (live?.threadId === providerSessionId) {
      // Without an invocation a connection lost meanwhile fails instead of going cold unauthenticated.
      await waitForPromiseWithSignal(
        renameCodexProviderSession({ session: live, record, providerSessionId, name }),
        signal
      )
      return
    }
    if (
      record.provider !== 'codex' ||
      !supportsCodexStructuredLocation(record.location) ||
      !agentDrivesSession({ definition: () => CODEX_STRUCTURED_AGENT }, record) ||
      !invocation
    ) {
      throw new DashboardAllocationError()
    }
    await runCodexPoolProviderAppServer(
      input.owner,
      record,
      invocation,
      {
        timeoutMs: RENAME_TIMEOUT_MS,
        signal,
        operation: DashboardCodexRefreshOperation.RenameSession
      },
      async (rpc) => {
        await rpc.request(
          'thread/name/set',
          { threadId: providerSessionId, name },
          { timeoutMs: RENAME_TIMEOUT_MS }
        )
      }
    )
  } catch {
    throw new DashboardAllocationError()
  }
}
