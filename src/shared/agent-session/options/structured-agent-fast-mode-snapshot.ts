// Fork: Claude Fast is offered only after the host verified the account; until then it stays visible but disabled.

import type { AgentSessionModelCatalogResult } from '../agent-session-wire'
import type { SessionOptionDescriptor } from '../../native-chat/input/native-chat-session-options'
import type { StructuredAgentSessionOptionState } from './structured-agent-session-options'

/** An unconfirmed account still draws each model's Fast row, which stays disabled. */
export function catalogOffersFastMode(catalog: AgentSessionModelCatalogResult): boolean {
  const support = catalog.origin === 'unknown' ? undefined : catalog.fastModeSupport
  return support?.supported === true || support?.reason === 'availability-unconfirmed'
}

/** Before an options answer, or for a model whose listing states no Fast capability, Claude Fast is disabled. */
export function claudeFastModeUnconfirmed(
  state: StructuredAgentSessionOptionState,
  snapshot: readonly SessionOptionDescriptor[]
): boolean {
  if (
    state.record.agent !== 'claude' ||
    (state.catalogSource !== 'host' && state.catalogSource !== 'live')
  ) {
    return false
  }
  const model = snapshot.find((descriptor) => descriptor.id === 'model')
  const modelId = model?.kind.type === 'select' ? model.kind.currentValue : undefined
  const row = state.catalog?.models.find((entry) => entry.id === modelId)
  return !state.optionsAnswerPresent || (Boolean(modelId) && row?.supportsFastMode === undefined)
}

/** Shows an unconfirmed Claude Fast disabled instead of hiding it. */
export function withClaudeUnconfirmedFastMode(
  state: StructuredAgentSessionOptionState,
  snapshot: SessionOptionDescriptor[]
): SessionOptionDescriptor[] {
  if (!claudeFastModeUnconfirmed(state, snapshot)) {
    return snapshot
  }
  const fast = snapshot.find((descriptor) => descriptor.id === 'fastMode')
  if (fast) {
    return snapshot.map((descriptor) =>
      descriptor === fast ? { ...descriptor, settable: false } : descriptor
    )
  }
  // A model listed without Fast stays without it; only an unknown capability earns the disabled row.
  const model = snapshot.find((descriptor) => descriptor.id === 'model')
  const modelId = model?.kind.type === 'select' ? model.kind.currentValue : undefined
  if (
    state.catalog?.models.some((entry) => entry.id === modelId && entry.supportsFastMode === false)
  ) {
    return snapshot
  }
  return [
    ...snapshot,
    {
      id: 'fastMode',
      label: 'Fast mode',
      category: 'mode',
      kind: { type: 'boolean', currentValue: false },
      valueSource: 'unknown',
      transport: 'agent-session',
      settable: false
    }
  ]
}
