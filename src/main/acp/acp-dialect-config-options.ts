import type { AgentSessionOptionsResult } from '../../shared/agent-session/options/agent-session-options-result'
import type { AcpDialect } from './acp-dialects/acp-dialect'
import type { SessionConfigOption, SessionModelState } from './generated/acp-protocol.generated'
import { acpSelectChoices } from './options/acp-select-choices'

export type AcpSelectOption = Extract<SessionConfigOption, { type: 'select' }>

export type AcpStructuredOptionsDialect = Pick<
  AcpDialect,
  | 'modelEfforts'
  | 'withheldCommands'
  | 'effortChangesModel'
  | 'clampsUnlistedEffort'
  | 'builtinCommands'
  | 'effortOptionIds'
  | 'fastOptionId'
>

type AcpReadOptions = Pick<AgentSessionOptionsResult, 'models' | 'current' | 'forkSupport'>

function isSelect(option: SessionConfigOption): option is AcpSelectOption {
  return option.type === 'select'
}

/** A model reporting several thought_level options uses the dialect's preferred one. */
export function selectAcpConfigOption(
  configOptions: readonly SessionConfigOption[],
  category: string,
  effortOptionIds: readonly string[] | undefined
): AcpSelectOption | null {
  const matches = (entry: SessionConfigOption) =>
    entry.category === category || (category === 'model' && entry.id === 'model')
  const preferred =
    category === 'thought_level'
      ? configOptions.find((entry) => matches(entry) && effortOptionIds?.includes(entry.id))
      : undefined
  const option = preferred ?? configOptions.find(matches)
  return option && isSelect(option) ? option : null
}

// Only the current model's options prove Fast; other models stay unknown.
export function acpFastOption(
  configOptions: readonly SessionConfigOption[],
  fastOptionId: string | undefined
): AcpSelectOption | null {
  const option = fastOptionId ? configOptions.find((entry) => entry.id === fastOptionId) : undefined
  return option && isSelect(option) ? option : null
}

export function withAcpFastMode(
  configOptions: readonly SessionConfigOption[],
  fastOptionId: string | undefined,
  read: AcpReadOptions
): AcpReadOptions {
  const fastOption = acpFastOption(configOptions, fastOptionId)
  if (!fastOption) {
    return read
  }
  const currentModel = read.current.model
  return {
    ...read,
    models: read.models.map((model) =>
      model.id === currentModel ? { ...model, supportsFastMode: true } : model
    ),
    current: {
      ...read.current,
      fastMode: fastOption.currentValue === 'true',
      confirmed: [...(read.current.confirmed ?? []), 'fastMode']
    }
  }
}

/** Model ids the session lists: its model config option, else the legacy model state. */
export function listedAcpModelIds(
  modelOption: AcpSelectOption | null,
  models: SessionModelState | null
): string[] {
  return modelOption
    ? acpSelectChoices(modelOption).map((choice) => choice.value)
    : (models?.availableModels.map((model) => model.modelId) ?? [])
}

/** Orca's own Full access runs the agent in its ask mode, so an ask report under it reads as Full access. */
export function acpReportedFullAccessMode(
  mode: string | null,
  appliedPermissionMode: string | undefined
): string | null {
  return mode === 'ask' && appliedPermissionMode === 'full-access' ? 'full-access' : mode
}
