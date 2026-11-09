import { AgentConversationCopyError } from '../native-chat/agent-conversation-copy-error'
import { asRecord } from '../ai-vault/session-scanner-values'
import type { StructuredAgentSessionConversationCopyInput } from '../native-chat/agent-session-wire/providers/structured-agent-session-conversation-copy-input'
import type { StructuredAgentSessionConversationCopyResult } from '../native-chat/agent-session-wire/providers/structured-agent-session-conversation-copy-result'
import type { CodexPoolIdentity } from '../../shared/agent-session/lifecycle/agent-session-pool-account'
import {
  DashboardAllocationError,
  DashboardToolProvider
} from '../dashboard-accounts/dashboard-allocation-protocol'
import { CodexPoolCopyReceiptSchema } from '../dashboard-accounts/dashboard-codex-pool-copy'
import { DashboardCodexRefreshOperation } from '../dashboard-accounts/dashboard-codex-refresh-protocol'
import {
  codexForkBoundaryUnavailable as unavailable,
  codexForkHistory,
  prepareCodexCopyBoundary
} from './codex-conversation-copy-boundary'
import {
  CodexAppServerTimeoutError,
  type CodexAppServerRpc
} from './app-server/codex-app-server-session'
import {
  prepareCodexProviderInvocation,
  runCodexProviderAppServer,
  type CodexProviderInvocationDeps
} from './structured/session-lifecycle/codex-provider-session-rename'
import type { CodexShortLivedOperations } from './structured/session-lifecycle/codex-short-lived-operations'

async function turns(
  rpc: CodexAppServerRpc,
  threadId: string,
  count: number
): Promise<{ id: string }[]> {
  const all: { id: string }[] = []
  let cursor: string | null = null
  const seen = new Set<string>()
  do {
    const page = asRecord(
      await rpc.request('thread/turns/list', { threadId, cursor, sortDirection: 'asc', limit: 100 })
    )
    if (!Array.isArray(page?.data)) {
      return unavailable()
    }
    for (const raw of page.data) {
      const turn = asRecord(raw)
      if (typeof turn?.id !== 'string') {
        return unavailable()
      }
      all.push({ id: turn.id })
    }
    cursor = typeof page.nextCursor === 'string' ? page.nextCursor : null
    if (cursor && seen.has(cursor)) {
      return unavailable()
    }
    if (cursor) {
      seen.add(cursor)
    }
  } while (cursor && all.length < count)
  return all
}

export async function copyCodexConversation(
  input: StructuredAgentSessionConversationCopyInput,
  invocation: CodexProviderInvocationDeps | undefined,
  owner?: CodexShortLivedOperations
): Promise<StructuredAgentSessionConversationCopyResult> {
  const pool = process.env.ORCA_DASHBOARD_INSTANCE_ID !== undefined || !!input.record?.poolAccount
  let boundary!: Awaited<ReturnType<typeof prepareCodexCopyBoundary>>
  try {
    if (!input.record || !input.checkpoint || !invocation) {
      return unavailable()
    }
    if (pool && !owner) {
      throw new DashboardAllocationError()
    }
    const { record, checkpoint } = input
    const signal = owner
      ? input.signal
      : AbortSignal.any([AbortSignal.timeout(60_000), ...(input.signal ? [input.signal] : [])])
    const options = {
      timeoutMs: 60_000,
      signal,
      operation: DashboardCodexRefreshOperation.CopyConversation
    }
    const configured = {
      ...invocation,
      resolveLaunchArgs: () => record.launchArgs ?? invocation.resolveLaunchArgs()
    }
    const body = async (
      rpc: CodexAppServerRpc,
      cwd: string,
      identity: CodexPoolIdentity | null
    ): Promise<StructuredAgentSessionConversationCopyResult> => {
      rpc.signal?.throwIfAborted()
      const { lastTurnId, beforeTurnId, find, stores } = boundary
      const fork = asRecord(
        await rpc.request('thread/fork', {
          threadId: input.providerSessionId,
          ...(lastTurnId ? { lastTurnId } : beforeTurnId ? { beforeTurnId } : {}),
          excludeTurns: true,
          cwd
        })
      )
      const thread = asRecord(fork?.thread)
      const id = thread?.id
      if (typeof id !== 'string' || !id.trim() || id === input.providerSessionId) {
        return unavailable()
      }
      if (!lastTurnId && !beforeTurnId) {
        // Reconcile against the child's actual capture; a parent can grow while fork runs.
        if (thread?.historyMode !== 'paginated') {
          return unavailable()
        }
        const captured = await codexForkHistory({
          path: await find(id),
          roots: stores,
          selectedItemId: checkpoint.selectedItemId,
          turnId: checkpoint.turnId,
          sessionId: id,
          signal: rpc.signal ?? boundary.signal
        })
        const childTurns = await turns(rpc, id, captured.roots.length + 1)
        if (childTurns.length !== captured.roots.length) {
          return unavailable()
        }
        for (const [index, root] of captured.roots.entries()) {
          if (root.id && root.id !== childTurns[index]?.id) {
            return unavailable()
          }
        }
        const firstRemoved = childTurns[captured.index + 1]
        if (firstRemoved) {
          await rpc.request('thread/revert', { threadId: id, beforeTurnId: firstRemoved.id })
          const kept = await turns(rpc, id, captured.index + 2)
          if (
            kept.length !== captured.index + 1 ||
            kept.at(-1)?.id !== childTurns[captured.index]?.id
          ) {
            return unavailable()
          }
        }
      }
      rpc.signal?.throwIfAborted()
      const poolCopy = identity
        ? CodexPoolCopyReceiptSchema.parse({
            provider: DashboardToolProvider.Codex,
            sourceSessionId: record.sessionId,
            sourceProviderSessionId: input.providerSessionId,
            targetProviderSessionId: id,
            identity
          })
        : undefined
      return { sessionId: id, ...(poolCopy ? { poolCopy } : {}) }
    }
    if (owner) {
      return await owner.run(
        record,
        options,
        async (readSignal) => {
          boundary = await prepareCodexCopyBoundary({
            record,
            checkpoint,
            providerSessionId: input.providerSessionId,
            signal: readSignal
          })
          return prepareCodexProviderInvocation(
            record,
            configured,
            {
              ...options,
              experimentalApi: !boundary.lastTurnId && Boolean(boundary.beforeTurnId)
            },
            readSignal
          )
        },
        body
      )
    }
    boundary = await prepareCodexCopyBoundary({
      record,
      checkpoint,
      providerSessionId: input.providerSessionId,
      signal
    })
    return await runCodexProviderAppServer(
      record,
      configured,
      {
        ...options,
        experimentalApi: !boundary.lastTurnId && Boolean(boundary.beforeTurnId)
      },
      body
    )
  } catch (error) {
    if (pool) {
      throw new DashboardAllocationError()
    }
    if (!boundary || error instanceof AgentConversationCopyError) {
      throw error
    }
    if (
      error instanceof CodexAppServerTimeoutError ||
      boundary.signal?.reason instanceof CodexAppServerTimeoutError ||
      input.signal?.aborted ||
      (!owner && boundary.signal?.aborted)
    ) {
      throw new AgentConversationCopyError('Codex took too long to copy this chat. Try again.', {
        cause: error
      })
    }
    if (
      error instanceof Error &&
      /(?:in[- ]progress|active turn|turn.*running)/i.test(error.message)
    ) {
      throw new AgentConversationCopyError(
        'Codex could not copy this chat while a response was running. Wait for it to finish, then try again.',
        { cause: error }
      )
    }
    throw new AgentConversationCopyError('Codex could not copy this chat. Try again.', {
      cause: error
    })
  }
}
