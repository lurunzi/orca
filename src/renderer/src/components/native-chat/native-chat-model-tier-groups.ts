import type { SessionOptionSelectChoice } from '../../../../shared/native-chat-session-options'

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

export type ModelTierChoice = SessionOptionSelectChoice & { tier: string; tierLabel: string }

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
    /^(.*)-(none|minimal|low|medium|high|xhigh|max|ultra)(-thinking)?(-fast)?$/
  )
  if (!suffix) {
    return null
  }
  const groupId = `${suffix[1]}${suffix[3] ?? ''}${suffix[4] ?? ''}`
  const label = (choice.label === choice.value ? groupId : choice.label)
    .replace(/\s+(?:extra high|xhigh|none|minimal|low|medium|high|max|ultra)(?=\s|$)/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    ...choice,
    label,
    groupKey: `id:${groupId}`,
    tier: suffix[2],
    tierLabel:
      suffix[2] === 'xhigh' ? 'Extra high' : suffix[2][0].toUpperCase() + suffix[2].slice(1)
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
    const group = groupsById.get(`id:${entry.choice.value}`)
    if (!entry.tiered && group) {
      entry.tiered = {
        ...entry.choice,
        label: group.label,
        groupKey: group.groupKey,
        tier: 'default',
        tierLabel: 'Default'
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
        baseLabel: tiered.label,
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
