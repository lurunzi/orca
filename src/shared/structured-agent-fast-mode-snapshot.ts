import type {
  AgentSessionModelCatalogResult,
  AgentSessionModelOption,
  AgentSessionOptionsResult
} from './agent-session-wire'
import type { SessionOptionDescriptor } from './native-chat/input/native-chat-session-options'

export function applyStructuredAgentFastModeAvailability(args: {
  snapshot: SessionOptionDescriptor[]
  agent: string
  modelSupport?: ReadonlyMap<string, boolean | undefined>
  support?: AgentSessionOptionsResult['fastModeSupport']
}): SessionOptionDescriptor[] {
  const { snapshot, agent, modelSupport, support } = args
  const model = snapshot.find((descriptor) => descriptor.id === 'model')
  const modelId = model?.kind.type === 'select' ? model.kind.currentValue : undefined
  if (
    agent === 'claude' &&
    modelId &&
    modelSupport &&
    modelSupport.get(modelId) === undefined &&
    !snapshot.some((descriptor) => descriptor.id === 'fastMode')
  ) {
    // Missing model capability explains an unavailable control; it never grants Fast access.
    snapshot.push({
      id: 'fastMode',
      label: 'Fast mode',
      category: 'mode',
      kind: { type: 'boolean', currentValue: false },
      valueSource: 'unknown',
      transport: 'agent-session',
      settable: false,
      disabledReason: 'fast-mode-availability-unconfirmed'
    })
    return snapshot
  }
  if (support?.supported !== false) {
    return snapshot
  }
  return snapshot.map((descriptor) =>
    descriptor.id === 'fastMode' && descriptor.kind.type === 'boolean'
      ? {
          ...descriptor,
          kind: { ...descriptor.kind, currentValue: false },
          settable: false,
          disabledReason:
            support.reason === 'availability-unconfirmed'
              ? 'fast-mode-availability-unconfirmed'
              : support.reason === 'extra_usage_disabled'
                ? 'fast-mode-extra-usage-required'
                : 'fast-mode-unavailable'
        }
      : descriptor
  )
}

type StructuredAgentFastModeState = {
  fastModeSupport?: AgentSessionOptionsResult['fastModeSupport']
  fastModeModelSupport: ReadonlyMap<string, boolean | undefined>
}

function modelFastModeSupport(
  models: readonly AgentSessionModelOption[]
): ReadonlyMap<string, boolean | undefined> {
  return new Map(models.map((model) => [model.id, model.supportsFastMode]))
}

/** A saved catalog never confirms Claude account permission for Fast. */
export function catalogFastModeState(
  agent: string,
  catalog: Exclude<AgentSessionModelCatalogResult, { origin: 'unknown' }>
): StructuredAgentFastModeState {
  return {
    fastModeModelSupport: modelFastModeSupport(catalog.models),
    fastModeSupport:
      agent === 'claude'
        ? { supported: false, reason: 'availability-unconfirmed' }
        : catalog.fastModeSupport
  }
}

/** A live Claude answer offers Fast only once the host verified the account. */
export function liveFastModeState(
  agent: string,
  result: AgentSessionOptionsResult
): StructuredAgentFastModeState {
  return {
    fastModeModelSupport: modelFastModeSupport(result.models),
    fastModeSupport:
      agent === 'claude' &&
      result.fastModeSupport?.supported !== false &&
      result.fastModeSupport?.accountVerified !== true
        ? { supported: false, reason: 'availability-unconfirmed' }
        : result.fastModeSupport
  }
}
