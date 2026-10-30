import type {
  SessionOptionDescriptor,
  SessionOptionSelectChoice
} from '../../../../shared/native-chat/input/native-chat-session-options'

// The picker groups CLI variants without changing the actual model ids sent to the host.
const TIER_BY_LABEL: Record<string, string> = {
  none: 'none',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  'extra high': 'xhigh',
  max: 'max',
  ultra: 'ultra'
}

export type ModelTierChoice = SessionOptionSelectChoice & {
  tier: string
  tierLabel: string
  speed?: 'default' | 'fast'
  thinking?: boolean
}

export type ModelPickerRow =
  | { kind: 'model'; choice: SessionOptionSelectChoice }
  | { kind: 'tiered'; source: 'label' | 'id'; baseLabel: string; tiers: ModelTierChoice[] }

type ParsedTierChoice = ModelTierChoice & { groupKey: string }

function parseTieredChoice(choice: SessionOptionSelectChoice): ParsedTierChoice | null {
  const match = choice.label.match(/^(.*\S)\s+\(([^()]+)\)$/)
  const tier = match ? TIER_BY_LABEL[match[2].trim().toLowerCase()] : undefined
  if (match && tier) {
    return {
      ...choice,
      label: match[1],
      groupKey: `label:${match[1]}`,
      tier,
      tierLabel: match[2].trim()
    }
  }
  // Cursor sometimes omits the effort from its display name, so read its explicit id suffix.
  const suffix = choice.value.match(
    /^(.*?)-(none|minimal|low|medium|high|extra-high|xhigh|max|ultra)(-thinking)?(-fast)?$/
  )
  const thinkingOnly = choice.value.match(/^(.*?)-thinking(-fast)?$/)
  if (!suffix && !thinkingOnly) {
    return null
  }
  const groupId = (suffix?.[1] ?? thinkingOnly?.[1] ?? '').replace(/-thinking$/, '')
  const effort = suffix?.[2] ?? 'default'
  const thinking = /-thinking(?:-|$)/.test(choice.value)
  const label = (choice.label === choice.value ? groupId : choice.label)
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+fast$/i, '')
    .replace(/\s+(?:extra high|xhigh|none|minimal|low|medium|high|max|ultra)(?=\s|$)/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    ...choice,
    label,
    groupKey: `id:${groupId}`,
    tier: effort === 'extra-high' ? 'xhigh' : effort,
    speed: choice.value.endsWith('-fast') ? 'fast' : 'default',
    thinking,
    tierLabel: ['xhigh', 'extra-high'].includes(effort)
      ? 'Extra high'
      : effort[0].toUpperCase() + effort.slice(1)
  }
}

/** Groups CLI tier siblings; a lone tier keeps its full label. */
export function buildModelPickerRows(
  choices: readonly SessionOptionSelectChoice[]
): ModelPickerRow[] {
  const parsed = choices.map((choice) => ({ choice, tiered: parseTieredChoice(choice) }))
  const groupsById = new Map(
    parsed.flatMap(({ tiered }) =>
      tiered?.groupKey.startsWith('id:') ? [[tiered.groupKey, tiered] as const] : []
    )
  )
  for (const entry of parsed) {
    const baseId = entry.choice.value.replace(/-fast$/, '')
    const group = groupsById.get(`id:${baseId}`)
    const speedPair =
      choices.some((choice) => choice.value === `${baseId}-fast`) &&
      choices.some((choice) => choice.value === baseId)
    if (!entry.tiered && (group || speedPair)) {
      entry.tiered = {
        ...entry.choice,
        label: group?.label ?? entry.choice.label.replace(/\s+fast[\u200b-\u200d\ufeff]*$/i, ''),
        groupKey: group?.groupKey ?? `id:${baseId}`,
        tier: 'default',
        tierLabel: 'Default',
        thinking: false,
        speed: entry.choice.value.endsWith('-fast') ? 'fast' : 'default'
      }
    }
  }
  const siblings = new Map<string, ModelTierChoice[]>()
  for (const { tiered } of parsed) {
    if (tiered) {
      siblings.set(tiered.groupKey, [...(siblings.get(tiered.groupKey) ?? []), tiered])
    }
  }
  const rows: ModelPickerRow[] = []
  const emitted = new Set<string>()
  for (const { choice, tiered } of parsed) {
    const tiers = tiered ? siblings.get(tiered.groupKey) : undefined
    if (!tiered || !tiers || tiers.length < 2) {
      rows.push({ kind: 'model', choice })
    } else if (!emitted.has(tiered.groupKey)) {
      emitted.add(tiered.groupKey)
      rows.push({
        kind: 'tiered',
        source: tiered.groupKey.startsWith('id:') ? 'id' : 'label',
        baseLabel:
          new Set(tiers.map((tier) => tier.thinking)).size > 1
            ? tiered.label.replace(/\s+(?:no )?thinking\b/gi, '').trim()
            : tiered.label,
        tiers
      })
    }
  }
  return rows
}

export function findTieredRow(
  rows: readonly ModelPickerRow[],
  value: string | undefined
): Extract<ModelPickerRow, { kind: 'tiered' }> | null {
  for (const row of rows) {
    if (row.kind === 'tiered' && row.tiers.some((tier) => tier.value === value)) {
      return row
    }
  }
  return null
}

/** Present encoded model tiers through the current picker while sending the original model id. */
export function projectModelTierOptions(snapshot: SessionOptionDescriptor[]): {
  snapshot: SessionOptionDescriptor[]
  tierModelId: string | null
  speedModelValues?: Record<string, string>
  thinkingModelValues?: Record<string, string>
} {
  const model = snapshot.find((option) => option.category === 'model')
  if (
    !model ||
    model.kind.type !== 'select' ||
    model.action ||
    snapshot.some((option) => ['effort', 'serviceTier', 'fastMode', 'thinking'].includes(option.id))
  ) {
    return { snapshot, tierModelId: null }
  }
  const rows = buildModelPickerRows(model.kind.choices)
  const current = model.kind.currentValue
  const active = findTieredRow(rows, current)
  const selected = active?.tiers.find((choice) => choice.value === current)
  const tier = selected?.tier
  const speed = selected?.speed ?? 'default'
  const thinking = selected?.thinking
  const choices = rows.map((row) => {
    if (row.kind === 'model') {
      return row.choice
    }
    const choice =
      row.tiers.find((choice) => choice.value === current) ??
      row.tiers.find(
        (choice) =>
          choice.tier === tier &&
          (choice.speed ?? 'default') === speed &&
          choice.thinking === thinking
      ) ??
      row.tiers.find((choice) => choice.tier === tier && (choice.speed ?? 'default') === speed) ??
      row.tiers.find(
        (choice) => (choice.speed ?? 'default') === speed && choice.thinking === thinking
      ) ??
      row.tiers.find((choice) => (choice.speed ?? 'default') === speed) ??
      row.tiers[0]
    return { ...choice, label: row.baseLabel }
  })
  const projected = snapshot.map((option) =>
    option === model
      ? {
          ...model,
          kind: { type: 'select' as const, currentValue: current, choices }
        }
      : option
  )
  const efforts =
    active?.tiers.filter(
      (choice) => (choice.speed ?? 'default') === speed && choice.thinking === thinking
    ) ?? []
  const tierOrder = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
  efforts.sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier))
  if (new Set(efforts.map((choice) => choice.tier)).size > 1) {
    projected.push({
      ...model,
      id: 'effort',
      label: 'Effort',
      category: 'thought_level',
      kind: {
        type: 'select',
        currentValue: current,
        choices: efforts.map((choice) => ({ value: choice.value, label: choice.tierLabel }))
      }
    })
  }
  const thoughts =
    active?.tiers.filter(
      (choice) => choice.tier === tier && (choice.speed ?? 'default') === speed
    ) ?? []
  const thinkingModelValues =
    new Set(thoughts.map((choice) => choice.thinking)).size > 1
      ? Object.fromEntries(thoughts.map((choice) => [String(choice.thinking), choice.value]))
      : undefined
  if (active && new Set(active.tiers.map((choice) => choice.thinking)).size > 1) {
    projected.push({
      ...model,
      id: 'thinking',
      label: 'Thinking',
      category: 'model_config',
      settable: model.settable && Boolean(thinkingModelValues),
      kind: { type: 'boolean', currentValue: thinking === true }
    })
  }
  const speeds =
    active?.tiers.filter((choice) => choice.tier === tier && choice.thinking === thinking) ?? []
  if (new Set(speeds.map((choice) => choice.speed)).size > 1) {
    const speedModelValues = Object.fromEntries(
      speeds.map((choice) => [choice.speed ?? 'default', choice.value])
    )
    projected.push({
      ...model,
      id: 'serviceTier',
      label: 'Speed',
      category: 'mode',
      kind: {
        type: 'select',
        currentValue: speed,
        choices: ['default', 'fast']
          .filter((value) => speedModelValues[value])
          .map((value) => ({
            value,
            label: value === 'fast' ? 'Fast' : 'Standard'
          }))
      }
    })
    return { snapshot: projected, tierModelId: model.id, speedModelValues, thinkingModelValues }
  }
  return { snapshot: projected, tierModelId: active ? model.id : null, thinkingModelValues }
}
