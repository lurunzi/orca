import { stripScrollbackAnsi } from './native-chat-scrape-fallback'

export type CursorModelTarget = {
  label: string
  effort?: string
  context?: string
  fast: boolean
  thinking: boolean
}

export function cursorModelTarget(id: string, label: string): CursorModelTarget {
  const effort =
    /-(none|minimal|low|medium|high|extra-high|xhigh|max|ultra)(?:-thinking)?(?:-fast)?$/.exec(
      id
    )?.[1]
  const context = /\b(\d+[mk])\b/i.exec(label)?.[1]?.toLowerCase()
  return {
    label: label
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\s*\(NO ZDR\)/gi, '')
      .replace(
        /\b(?:extra high|xhigh|none|minimal|low|medium|high|max|ultra|fast|(?:no )?thinking|\d+[mk])\b/gi,
        ''
      )
      .replace(/\s+/g, ' ')
      .trim(),
    ...(effort ? { effort: effort.replace('extra-high', 'xhigh') } : {}),
    ...(context ? { context } : {}),
    fast: id.endsWith('-fast'),
    thinking: /-thinking(?:-|$)/.test(id)
  }
}

export function cursorPickerLines(screen: string): string[] {
  const gaps = new RegExp(`${String.fromCharCode(27)}\\[(\\d*)C`, 'g')
  return stripScrollbackAnsi(
    screen.replace(gaps, (_match, count: string) => ' '.repeat(Math.min(Number(count) || 1, 4096)))
  )
    .split('\n')
    .map((line) => line.trimEnd())
}

export function cursorModelMenu(screen: string, filter: string): boolean {
  screen = cursorPickerLines(screen).join('\n')
  return (
    screen.includes(`Models matching "${filter}"`) && /(?:Type|Edit prompt) to filter/.test(screen)
  )
}

export function cursorParameterEditor(screen: string, target: CursorModelTarget): boolean {
  screen = cursorPickerLines(screen).join('\n')
  return screen.includes(`${target.label} — Edit Parameters`) && screen.includes('Esc to go back')
}

export type CursorParameterRow = {
  key: string
  label: string
  section: string
  focused: boolean
  checked: boolean
}

export function cursorParameterRows(screen: string): CursorParameterRow[] {
  let section = ''
  const rows: CursorParameterRow[] = []
  for (const line of cursorPickerLines(screen)) {
    const heading = /^\s*(Context|Effort|Thinking)\s*$/.exec(line)
    if (heading) {
      section = heading[1].toLowerCase()
    }
    const row = /^\s*(→\s*)?([○●◯◉])\s+(.+?)(?:\s+✓)?\s*$/.exec(line)
    if (!row) {
      continue
    }
    const label = row[3].trim()
    const category = /^(Fast|Thinking)$/i.test(label) ? label.toLowerCase() : section
    rows.push({
      key: `${category}:${label}`,
      section: category,
      label,
      focused: Boolean(row[1]),
      checked: row[2] === '●' || row[2] === '◉'
    })
  }
  return rows
}

export function cursorParameterChange(
  rows: CursorParameterRow[],
  target: CursorModelTarget
): CursorParameterRow | null {
  const normalize = (value: string): string => value.toLowerCase().replace('extra high', 'xhigh')
  for (const [section, value] of Object.entries({
    context: target.context,
    effort: target.effort,
    fast: target.fast,
    thinking: target.thinking
  })) {
    if (value === undefined) {
      continue
    }
    const choices = rows.filter((row) => row.section === section)
    if (!choices.length) {
      if (value === false) {
        continue
      }
      throw new Error(`Cursor did not expose the requested ${section}.`)
    }
    const wanted = choices.find(
      (row) => typeof value === 'boolean' || normalize(row.label) === value
    )
    if (!wanted) {
      throw new Error(`Cursor did not expose the requested ${section} value.`)
    }
    if (wanted.checked !== (typeof value === 'boolean' ? value : true)) {
      return wanted
    }
  }
  return null
}

export function cursorModelFooterMatches(screen: string, target: CursorModelTarget): boolean {
  if (/Models matching|Edit Parameters/.test(screen)) {
    return false
  }
  const lines = cursorPickerLines(screen)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.some((line, index) => {
    if (!/^(?:[A-Za-z]:[\\/]|\/|~\/|\\\\)/.test(line)) {
      return false
    }
    const model = lines[index - 1] ?? ''
    return model === target.label || model.startsWith(`${target.label} `)
  })
}
