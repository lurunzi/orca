import { z } from 'zod'
import type { AgentSessionModelOption } from '../../../shared/agent-session/agent-session-wire'

export const CURSOR_LIST_MODELS = 'cursor/list_available_models'
/** Thought-level parameters that pick an effort; `thinking` only toggles reasoning on or off. */
export const CURSOR_EFFORT_OPTION_IDS = ['effort', 'reasoning_effort', 'reasoning'] as const
export const CURSOR_FAST_OPTION_ID = 'fast'

const parameterSchema = z.looseObject({
  id: z.string().min(1),
  category: z.string().nullish(),
  type: z.string().optional(),
  currentValue: z.unknown().optional(),
  options: z
    .array(z.looseObject({ value: z.string().min(1), name: z.string().optional() }))
    .optional()
})
const listingSchema = z.looseObject({
  models: z.array(
    z.looseObject({
      value: z.string().min(1),
      name: z.string().optional(),
      configOptions: z.array(z.unknown()).nullish()
    })
  )
})

function effortParameter(raw: readonly unknown[]): z.infer<typeof parameterSchema> | undefined {
  const parameters = raw.flatMap((entry) => {
    const parsed = parameterSchema.safeParse(entry)
    return parsed.success && parsed.data.category === 'thought_level' ? [parsed.data] : []
  })
  const ids: readonly string[] = CURSOR_EFFORT_OPTION_IDS
  return parameters.find((parameter) => ids.includes(parameter.id))
}

function offersFast(raw: readonly unknown[]): boolean {
  return raw.some((entry) => parameterSchema.safeParse(entry).data?.id === CURSOR_FAST_OPTION_ID)
}

/** Parses the session-free listing; ids match chats that opt into the parameterized picker. */
export function parseCursorModelListing(value: unknown): AgentSessionModelOption[] {
  const listing = listingSchema.safeParse(value)
  if (!listing.success) {
    throw new Error('cursor-agent did not list its models')
  }
  return listing.data.models.map((model) => {
    const parameters = model.configOptions ?? []
    const effort = effortParameter(parameters)
    const efforts = (effort?.options ?? []).map((option) => ({
      value: option.value,
      label: option.name || option.value
    }))
    const current = typeof effort?.currentValue === 'string' ? effort.currentValue : undefined
    return {
      id: model.value,
      label: model.name || model.value,
      isDefault: false,
      supportsFastMode: offersFast(parameters),
      efforts,
      // The listing reports this account's saved value for the model, not a provider default.
      declaredDefaultEffort: efforts.find(({ value }) => value === current)?.value ?? null
    }
  })
}

export async function readCursorModelCatalog(
  _initialized: unknown,
  connection: { requestSessionFreeExtension(method: string, params: unknown): Promise<unknown> }
): Promise<AgentSessionModelOption[]> {
  return parseCursorModelListing(
    await connection.requestSessionFreeExtension(CURSOR_LIST_MODELS, {})
  )
}
