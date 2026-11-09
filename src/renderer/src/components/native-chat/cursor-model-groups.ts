import type { SessionOptionSelectChoice } from '../../../../shared/native-chat/input/native-chat-session-options'

export type CursorModelGroups = {
  autoModel?: SessionOptionSelectChoice
  cursorModels: SessionOptionSelectChoice[]
  otherModels: SessionOptionSelectChoice[]
  moreModels: SessionOptionSelectChoice[]
}

// Suffix parser for effort and speed tier variants.
export function getModelVariantSuffix(value: string): string | null {
  const parts: string[] = []
  const suffix = value.match(
    /-(none|minimal|low|medium|high|extra-high|xhigh|max|ultra)(-thinking)?(-fast)?$/
  )
  if (suffix) {
    const rawEffort = suffix[1]
    const effortLabel =
      rawEffort === 'xhigh' || rawEffort === 'extra-high'
        ? 'Extra high'
        : rawEffort === 'none'
          ? 'None'
          : rawEffort[0].toUpperCase() + rawEffort.slice(1)
    parts.push(effortLabel)
  }
  if (value.endsWith('-fast') || /-fast(-|$)/.test(value)) {
    parts.push('Fast')
  }
  return parts.length > 0 ? parts.join(' ') : null
}

// True when the model belongs to Cursor's own families (Composer, Grok).
export function isCursorModelId(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return (
    id.startsWith('composer') ||
    id.startsWith('grok') ||
    id.startsWith('cursor-grok') ||
    id.startsWith('cursor_grok') ||
    id.startsWith('cursor-') ||
    id.startsWith('cursor_')
  )
}

// Vendor family grouping key (e.g. 'claude-opus', 'gemini', 'gpt').
export function getModelVendorFamily(modelId: string): string {
  const id = modelId.toLowerCase()
  if (
    id.startsWith('claude') ||
    id.includes('opus') ||
    id.includes('sonnet') ||
    id.includes('fable') ||
    id.includes('haiku')
  ) {
    if (id.includes('opus')) {
      return 'claude-opus'
    }
    if (id.includes('sonnet')) {
      return 'claude-sonnet'
    }
    if (id.includes('fable')) {
      return 'claude-fable'
    }
    if (id.includes('haiku')) {
      return 'claude-haiku'
    }
    return 'claude'
  }
  if (
    id.startsWith('gpt') ||
    id.startsWith('o1') ||
    id.startsWith('o3') ||
    id.startsWith('o4') ||
    id.includes('codex')
  ) {
    return 'gpt'
  }
  if (id.startsWith('gemini')) {
    return 'gemini'
  }
  const match = id.match(/^[a-z0-9]+/i)
  return match ? match[0] : id
}

// Extracts major and minor version numbers from a model choice id or label.
export function extractModelVersion(choice: SessionOptionSelectChoice): {
  major: number
  minor: number
} {
  const id = choice.value.toLowerCase()
  const idMatch = id.match(/(?:^|[-_a-z])(\d+)(?:[.-](\d+))?(?:[-_a-z]|$)/)
  if (idMatch) {
    const major = Number.parseInt(idMatch[1], 10)
    const minor = idMatch[2] ? Number.parseInt(idMatch[2], 10) : 0
    return { major, minor }
  }
  const labelMatch = choice.label.match(/\b(\d+)(?:\.(\d+))?\b/)
  if (labelMatch) {
    const major = Number.parseInt(labelMatch[1], 10)
    const minor = labelMatch[2] ? Number.parseInt(labelMatch[2], 10) : 0
    return { major, minor }
  }
  return { major: 0, minor: 0 }
}

const FLAGSHIP_FAMILY_ORDER = [
  'claude-opus',
  'gemini',
  'gpt',
  'claude-fable',
  'claude-sonnet',
  'claude-haiku'
]

// Groups model choices into Cursor Models, Other Models (flagships), and More Models.
export function groupCursorModels(
  choices: readonly SessionOptionSelectChoice[],
  currentValue?: string
): CursorModelGroups {
  let autoModel: SessionOptionSelectChoice | undefined
  const cursorModels: SessionOptionSelectChoice[] = []
  const vendorMap = new Map<string, SessionOptionSelectChoice[]>()

  for (const choice of choices) {
    if (choice.value.toLowerCase() === 'auto' || choice.label.toLowerCase() === 'auto') {
      autoModel = choice
      continue
    }
    if (isCursorModelId(choice.value)) {
      cursorModels.push(choice)
      continue
    }
    const family = getModelVendorFamily(choice.value)
    const list = vendorMap.get(family) ?? []
    list.push(choice)
    vendorMap.set(family, list)
  }

  cursorModels.sort((a, b) => {
    const aIsGrok = a.value.includes('grok')
    const bIsGrok = b.value.includes('grok')
    if (aIsGrok && !bIsGrok) {
      return -1
    }
    if (!aIsGrok && bIsGrok) {
      return 1
    }
    const vA = extractModelVersion(a)
    const vB = extractModelVersion(b)
    if (vB.major !== vA.major) {
      return vB.major - vA.major
    }
    return vB.minor - vA.minor
  })

  const otherModels: SessionOptionSelectChoice[] = []
  const moreModels: SessionOptionSelectChoice[] = []

  const sortedFamilies = [...vendorMap.keys()].sort((a, b) => {
    const idxA = FLAGSHIP_FAMILY_ORDER.indexOf(a)
    const idxB = FLAGSHIP_FAMILY_ORDER.indexOf(b)
    if (idxA !== -1 && idxB !== -1) {
      return idxA - idxB
    }
    if (idxA !== -1) {
      return -1
    }
    if (idxB !== -1) {
      return 1
    }
    return 0
  })

  for (const family of sortedFamilies) {
    const familyChoices = vendorMap.get(family) ?? []
    if (familyChoices.length === 0) {
      continue
    }

    const sorted = [...familyChoices].sort((a, b) => {
      const vA = extractModelVersion(a)
      const vB = extractModelVersion(b)
      if (vB.major !== vA.major) {
        return vB.major - vA.major
      }
      if (vB.minor !== vA.minor) {
        return vB.minor - vA.minor
      }
      return familyChoices.indexOf(a) - familyChoices.indexOf(b)
    })

    otherModels.push(sorted[0])
    for (let i = 1; i < sorted.length; i++) {
      moreModels.push(sorted[i])
    }
  }

  // Ensure currently selected model is always visible in the main list.
  if (currentValue) {
    const selectedIdx = moreModels.findIndex(
      (m) => m.value === currentValue || currentValue.startsWith(`${m.value}-`)
    )
    if (selectedIdx !== -1) {
      const [promoted] = moreModels.splice(selectedIdx, 1)
      otherModels.push(promoted)
    }
  }

  return { autoModel, cursorModels, otherModels, moreModels }
}
