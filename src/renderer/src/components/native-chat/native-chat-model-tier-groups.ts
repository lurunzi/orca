import type { SessionOptionSelectChoice } from '../../../../shared/native-chat-session-options'

// Why: some CLIs (Antigravity) list each effort tier as its own model id, e.g.
// `gemini-3.1-pro-high` "Gemini 3.1 Pro (High)". The ids stay the switch values;
// only the picker splits them into a model row plus a tier pill.
const TIER_BY_LABEL: Record<string, string> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  'extra high': 'xhigh',
  max: 'max'
}

export type ModelTierChoice = SessionOptionSelectChoice & { tier: string; tierLabel: string }

export type ModelPickerRow =
  | { kind: 'model'; choice: SessionOptionSelectChoice }
  | { kind: 'tiered'; baseLabel: string; tiers: ModelTierChoice[] }

function parseTieredChoice(choice: SessionOptionSelectChoice): ModelTierChoice | null {
  const match = choice.label.match(/^(.*\S)\s+\(([^()]+)\)$/)
  const tier = match ? TIER_BY_LABEL[match[2].trim().toLowerCase()] : undefined
  return match && tier ? { ...choice, label: match[1], tier, tierLabel: match[2].trim() } : null
}

/** Groups tier siblings that share a base label; a lone tier keeps its full label. */
export function buildModelPickerRows(
  choices: readonly SessionOptionSelectChoice[]
): ModelPickerRow[] {
  const parsed = choices.map((choice) => ({ choice, tiered: parseTieredChoice(choice) }))
  const siblings = new Map<string, ModelTierChoice[]>()
  for (const { tiered } of parsed) {
    if (tiered) {
      siblings.set(tiered.label, [...(siblings.get(tiered.label) ?? []), tiered])
    }
  }
  const rows: ModelPickerRow[] = []
  const emitted = new Set<string>()
  for (const { choice, tiered } of parsed) {
    const tiers = tiered ? siblings.get(tiered.label) : undefined
    if (!tiered || !tiers || tiers.length < 2) {
      rows.push({ kind: 'model', choice })
    } else if (!emitted.has(tiered.label)) {
      emitted.add(tiered.label)
      rows.push({ kind: 'tiered', baseLabel: tiered.label, tiers })
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

/** The model id a row switches to: the current id if it is in this row, else the
 *  sibling at the current tier, else the first tier the CLI listed. */
export function tieredRowTargetValue(
  row: Extract<ModelPickerRow, { kind: 'tiered' }>,
  currentTier: string | null
): string {
  return row.tiers.find((tier) => tier.tier === currentTier)?.value ?? row.tiers[0]?.value ?? ''
}
