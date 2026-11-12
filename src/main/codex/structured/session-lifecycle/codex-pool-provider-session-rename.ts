import { setTimeout as delay } from 'node:timers/promises'
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

const RENAME_TIMEOUT_MS = 15_000
const EMPTY_ROLLOUT = /\brollout at .+ is empty\b/i
const RETRY_DELAYS_MS = [50, 200] as const

async function renameActivePoolSession(
  session: CodexSession,
  threadId: string,
  name: string,
  signal?: AbortSignal
): Promise<void> {
  const request = async (): Promise<void> => {
    signal?.throwIfAborted()
    await waitForPromiseWithSignal(
      session.connection.request(
        'thread/name/set',
        { threadId, name },
        { timeoutMs: RENAME_TIMEOUT_MS }
      ),
      signal
    )
  }
  for (const retryDelay of RETRY_DELAYS_MS) {
    try {
      await request()
      return
    } catch (error) {
      signal?.throwIfAborted()
      if (!(error instanceof Error) || !EMPTY_ROLLOUT.test(error.message)) {
        throw error
      }
      await delay(retryDelay, undefined, { signal })
      signal?.throwIfAborted()
    }
  }
  await request()
}

/** Pool cold renames authenticate once; active renames cancel retries without closing the connection. */
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
      await renameActivePoolSession(live, providerSessionId, name, signal)
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
