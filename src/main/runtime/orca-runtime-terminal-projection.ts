import { detectTerminalComposerDraft } from '../../shared/terminal-composer-draft'
import { HeadlessEmulator } from '../daemon/headless-emulator'
import type { HeadlessTerminalRow } from '../daemon/headless-terminal-rows'
import type { RuntimeTerminalRowMetadata } from '../../shared/runtime-terminal-contracts'
import type { RuntimeTerminalProjection } from './orca-runtime-core'

type TerminalProjectionEmulator = Pick<
  HeadlessEmulator,
  'getBufferTailRows' | 'getVisibleRows' | 'getVisibleBufferRange' | 'getCursorLineContext'
>

function projectTerminalRows(
  rows: HeadlessTerminalRow[],
  limit = rows.length
): {
  lines: string[]
  tailRows: RuntimeTerminalRowMetadata[]
} {
  const projected: HeadlessTerminalRow[] = []
  let previous = -2
  rows.forEach((row, index) => {
    if (!row.text.trim()) {
      return
    }
    projected.push({
      text: row.text.trimEnd(),
      metadata: {
        ...row.metadata,
        trailingSpaces: row.metadata.trailingSpaces + row.text.length - row.text.trimEnd().length,
        wrapped: index === previous + 1 && row.metadata.wrapped
      }
    })
    previous = index
  })
  const kept = projected.slice(-limit)
  return {
    lines: kept.map((row) => row.text),
    tailRows: kept.map((row, index) => ({
      ...row.metadata,
      wrapped: index > 0 && row.metadata.wrapped
    }))
  }
}

export function projectTerminalTailLines(
  emulator: TerminalProjectionEmulator,
  limit: number
): { lines: string[]; tailRows: RuntimeTerminalRowMetadata[]; draft?: string } {
  const tail = emulator.getBufferTailRows(limit)
  const visible = emulator.getVisibleRows()
  const visibleRange = emulator.getVisibleBufferRange()
  const draft = detectTerminalComposerDraft(emulator.getCursorLineContext())
  if (draft && visibleRange.endExclusive === visibleRange.totalLength) {
    visible[draft.promptRow] = {
      text: draft.promptGlyph,
      metadata: { wrapped: false, trailingSpaces: 0 }
    }
    for (let row = draft.promptRow + 1; row <= draft.endRow; row += 1) {
      visible[row] = { text: '', metadata: { wrapped: false, trailingSpaces: 0 } }
    }
    const scrollbackTail = tail.slice(0, Math.max(0, tail.length - visible.length))
    tail.splice(0, tail.length, ...scrollbackTail, ...visible)
  }
  return {
    ...projectTerminalRows(tail, limit),
    ...(draft ? { draft: draft.text } : {})
  }
}

export function projectTerminalVisibleLines(emulator: TerminalProjectionEmulator): {
  lines: string[]
  tailRows: RuntimeTerminalRowMetadata[]
  draft?: string
} {
  const visible = emulator.getVisibleRows()
  const draft = detectTerminalComposerDraft(emulator.getCursorLineContext())
  if (draft) {
    visible[draft.promptRow] = {
      text: draft.promptGlyph,
      metadata: { wrapped: false, trailingSpaces: 0 }
    }
    for (let row = draft.promptRow + 1; row <= draft.endRow; row += 1) {
      visible[row] = { text: '', metadata: { wrapped: false, trailingSpaces: 0 } }
    }
  }
  return {
    ...projectTerminalRows(visible),
    ...(draft ? { draft: draft.text } : {})
  }
}

const PROJECTED_PROMPT_GLYPHS: ReadonlySet<string> = new Set(['❯', '›', '»'])

/** Restore blanked drafts before rules inspect what the TUI painted. */
export function restoreProjectedComposerDraft(
  lines: readonly string[],
  draft: string | undefined
): string[] {
  const promptRow = draft ? lines.findLastIndex((line) => PROJECTED_PROMPT_GLYPHS.has(line)) : -1
  if (draft === undefined || promptRow === -1) {
    return [...lines]
  }
  const [first = '', ...rest] = draft.split('\n')
  return [
    ...lines.slice(0, promptRow),
    `${lines[promptRow]} ${first}`,
    ...rest,
    ...lines.slice(promptRow + 1)
  ]
}

export async function parseTerminalVisibleSnapshot(snapshot: {
  data: string
  cols: number
  rows: number
}): Promise<RuntimeTerminalProjection> {
  if (snapshot.data.length === 0) {
    return { lines: [] }
  }
  const emulator = new HeadlessEmulator({
    cols: snapshot.cols,
    rows: snapshot.rows,
    scrollback: 0
  })
  try {
    await emulator.write(`\x1b[2J\x1b[3J\x1b[H${snapshot.data}`)
    return projectTerminalVisibleLines(emulator)
  } finally {
    emulator.dispose()
  }
}
