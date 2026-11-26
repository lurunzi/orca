import { agentChoiceCliApply } from '../../../agent-launch/choices/agent-choice-cli-apply'
import type { AgentSessionOptionCatalog, CatalogOption } from './agent-session-option-catalog-types'
import { parseAntigravityModels } from '../../../source-control/ai/generation/commit-message-model-parsers'

/** agy lists each level of a model family as "<family>-<level>", e.g. gemini-3.8-flash-low. */
export const ANTIGRAVITY_EFFORT_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const

export const ANTIGRAVITY_LEVEL_SUFFIX = new RegExp(
  `^(.+)-(${ANTIGRAVITY_EFFORT_LEVELS.join('|')})$`
)

/** agy's TUI runs its default model for a leveled id that conflicts with --effort (#39556). */
export function composeAntigravityLaunchModel(modelId: string, effort: unknown): string {
  const match = ANTIGRAVITY_LEVEL_SUFFIX.exec(modelId)
  return typeof effort === 'string' && match && match[2] !== effort ? match[1] : modelId
}

const ANTIGRAVITY_EFFORT: CatalogOption = {
  id: 'effort',
  label: 'Reasoning effort',
  category: 'thought_level',
  kind: {
    type: 'select',
    choices: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' }
    ],
    defaultValue: 'high'
  },
  apply: {
    ...agentChoiceCliApply(
      'antigravity',
      [
        {
          kind: 'value',
          names: ['--effort'],
          lift: 'separate-and-long-equals'
        }
      ],
      '--effort'
    ),
    midSession: { kind: 'command', build: (value) => `/effort ${String(value)}` }
  }
}

export const ANTIGRAVITY_SESSION_OPTION_CATALOG: AgentSessionOptionCatalog = {
  supportsWorkerLaunchPreferences: true,
  // Model availability is account-scoped; worker-start accepts the slug reported by `agy models`.
  models: [],
  modelApply: {
    ...agentChoiceCliApply(
      'antigravity',
      [
        {
          kind: 'value',
          names: ['--model'],
          lift: 'separate-and-long-equals'
        }
      ],
      '--model'
    ),
    // agy >= 1.2 switches by slug, so the chat lists models instead of opening the TUI picker.
    midSession: {
      kind: 'command',
      build: (value) => `/model ${String(value)}`,
      pickerCommand: '/model',
      pickerWhileDiscovering: true
    }
  },
  unknownModelOptions: [ANTIGRAVITY_EFFORT],
  composeModelValue: (modelId, values) => composeAntigravityLaunchModel(modelId, values.effort),
  // Why: the list is account-scoped, so a slug the account lost must be droppable.
  discoveredModelsAreAuthoritative: true,
  listModels: {
    command: 'agy models',
    parse: (stdout) => parseAntigravityModels(stdout).map((model) => ({ ...model, options: [] }))
  }
}
