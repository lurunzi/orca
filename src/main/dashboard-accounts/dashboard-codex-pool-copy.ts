import { z } from 'zod'
import { DashboardToolProvider } from '../../shared/dashboard-account-provider'
import {
  AgentSessionPoolAccountOrigin,
  CodexPoolIdentitySchema
} from '../../shared/agent-session/lifecycle/agent-session-pool-account'
import type { AgentSessionRecord } from '../../shared/agent-session/lifecycle/agent-session-record'
import type { StructuredAgentId } from '../../shared/agent-session/lifecycle/agent-session-provider-handle'
import { isAgentSessionProviderHandleField } from '../../shared/agent-session/lifecycle/agent-session-provider-handle-encoding'
import { activeProviderContext } from '../../shared/agent-session/agent-session-provider-context'
import { DashboardAllocationError } from './dashboard-allocation-protocol'
import { canUseCodexPoolIdentity } from './dashboard-codex-pool-authentication'

const providerSessionId = z.string().refine(isAgentSessionProviderHandleField)
export const CodexPoolCopyReceiptSchema = z.strictObject({
  provider: z.literal(DashboardToolProvider.Codex),
  sourceSessionId: z.string().min(1).max(128),
  sourceProviderSessionId: providerSessionId,
  targetProviderSessionId: providerSessionId,
  identity: CodexPoolIdentitySchema
})
export type CodexPoolCopyReceipt = z.infer<typeof CodexPoolCopyReceiptSchema>

export function requireCodexPoolCopyReceipt(input: {
  receipt: unknown
  source: AgentSessionRecord | null
  sourceSessionId: string
  agent: StructuredAgentId
  capturedSourceProviderSessionId: string | null
  currentSourceProviderSessionId: string | null
  targetProviderSessionId: string
}): CodexPoolCopyReceipt | undefined {
  const { source } = input
  if (input.receipt === undefined) {
    if (source?.poolAccount) {
      throw new DashboardAllocationError()
    }
    return undefined
  }
  const parsed = CodexPoolCopyReceiptSchema.safeParse(input.receipt)
  if (!parsed.success) {
    throw new DashboardAllocationError()
  }
  const receipt = parsed.data
  if (
    source?.provider !== DashboardToolProvider.Codex ||
    input.agent !== DashboardToolProvider.Codex ||
    source.sessionId !== input.sourceSessionId ||
    receipt.sourceSessionId !== source.sessionId ||
    receipt.sourceProviderSessionId !== input.capturedSourceProviderSessionId ||
    receipt.sourceProviderSessionId !== input.currentSourceProviderSessionId ||
    receipt.targetProviderSessionId !== input.targetProviderSessionId ||
    receipt.targetProviderSessionId === receipt.sourceProviderSessionId ||
    !source.poolAccount ||
    !canUseCodexPoolIdentity(source.poolAccount, receipt.identity)
  ) {
    throw new DashboardAllocationError()
  }
  return receipt
}

export function inheritCodexPoolCopyAccount(
  source: AgentSessionRecord | null,
  target: AgentSessionRecord,
  receipt: CodexPoolCopyReceipt
): AgentSessionRecord {
  const sourceHead = source ? activeProviderContext(source).head : null
  const targetHead = activeProviderContext(target).head
  if (
    !source ||
    target.sessionId === source.sessionId ||
    target.forkedFrom?.sessionId !== source.sessionId ||
    targetHead?.origin !== 'adopted' ||
    sourceHead?.handle.agent !== DashboardToolProvider.Codex ||
    targetHead.handle.agent !== DashboardToolProvider.Codex
  ) {
    throw new DashboardAllocationError()
  }
  const checked = requireCodexPoolCopyReceipt({
    receipt,
    source,
    sourceSessionId: target.forkedFrom.sessionId,
    agent: target.provider,
    capturedSourceProviderSessionId: receipt.sourceProviderSessionId,
    currentSourceProviderSessionId: sourceHead.handle.nativeId,
    targetProviderSessionId: targetHead.handle.nativeId
  })!
  return {
    ...target,
    poolAccount: {
      version: 1,
      origin: AgentSessionPoolAccountOrigin.InheritedCopy,
      ...checked.identity,
      sourceSessionId: checked.sourceSessionId
    }
  }
}
