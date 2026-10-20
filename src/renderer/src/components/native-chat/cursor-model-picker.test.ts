import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { describe, expect, it, vi } from 'vitest'
import {
  cursorModelTarget,
  cursorModelMenu,
  cursorParameterEditor,
  cursorParameterRows,
  cursorParameterChange,
  cursorModelFooterMatches
} from './cursor-model-picker'
import { switchCursorModel } from './cursor-model-switch'

// Cursor 2026.10.14, recorded with capture-agent-pty-transcript.mjs; no prompts submitted.
async function replay(name: string, rows = 50): Promise<string> {
  const terminal = new Terminal({ cols: 120, rows, allowProposedApi: true })
  const serializer = new SerializeAddon()
  terminal.loadAddon(serializer)
  try {
    const raw = readFileSync(join(__dirname, '__fixtures__', `${name}.txt`), 'utf8')
    await new Promise<void>((resolve) => terminal.write(raw, resolve))
    return serializer.serialize({ scrollback: 0 })
  } finally {
    terminal.dispose()
  }
}

describe('Cursor parameterized model picker captures', () => {
  it('accepts the Windows home-relative footer from Cursor 2026.10.19', async () => {
    const screen = await replay('cursor-grok-47-home-footer', 40)
    expect(
      cursorModelFooterMatches(screen, cursorModelTarget('grok-4.7-low', 'Grok 4.7 Low'))
    ).toBe(true)
    expect(
      cursorModelFooterMatches(screen, cursorModelTarget('grok-4.8-low', 'Grok 4.8 Low'))
    ).toBe(false)
  })

  it('recognizes the real no-match dialog instead of claiming the model was applied', async () => {
    const screen = await replay('cursor-model-id-filter', 32)
    expect(cursorModelMenu(screen, 'cursor-grok-4.5-high')).toBe(true)
    expect(
      cursorModelFooterMatches(screen, cursorModelTarget('cursor-grok-4.5-high', 'Grok 4.5'))
    ).toBe(false)
  })

  it('reads selected effort and Fast from the serialized Grok editor', async () => {
    const screen = await replay('cursor-model-parameters')
    const target = cursorModelTarget('cursor-grok-4.5-medium', 'Grok 4.5 Medium')
    expect(cursorParameterEditor(screen, target)).toBe(true)
    const rows = cursorParameterRows(screen)
    expect(rows.map(({ key, focused, checked }) => ({ key, focused, checked }))).toEqual([
      { key: 'effort:Low', focused: true, checked: false },
      { key: 'effort:Medium', focused: false, checked: false },
      { key: 'effort:High', focused: false, checked: true },
      { key: 'fast:Fast', focused: false, checked: true }
    ])
    expect(cursorParameterChange(rows, target)?.key).toBe('effort:Medium')
    expect(cursorParameterChange(rows, { ...target, effort: 'high' })?.key).toBe('fast:Fast')
    expect(cursorParameterChange(rows, { ...target, effort: 'high', fast: true })).toBeNull()
  })

  it('preserves the context requested by the listed Claude variant', async () => {
    const screen = await replay('cursor-model-parameters-context')
    const target = cursorModelTarget('claude-opus-5-5-medium', 'Claude Opus 5.5 1M')
    expect(target).toEqual({
      label: 'Claude Opus 5.5',
      effort: 'medium',
      context: '1m',
      fast: false,
      thinking: false
    })
    expect(cursorParameterChange(cursorParameterRows(screen), target)?.key).toBe('context:1M')
  })

  it('refuses an unavailable parameter instead of substituting the current value', async () => {
    const screen = await replay('cursor-model-parameters')
    expect(() =>
      cursorParameterChange(
        cursorParameterRows(screen),
        cursorModelTarget('cursor-grok-4.5-max', 'Grok 4.5 Max')
      )
    ).toThrow('requested effort value')
  })

  it('does not write when the pane is unreadable or the operation was canceled', async () => {
    for (const readable of [false, true]) {
      const controller = new AbortController()
      if (readable) {
        controller.abort()
      }
      const write = vi.fn(async () => true)
      expect(
        await switchCursorModel({
          modelId: 'cursor-grok-4.5-high',
          modelLabel: 'Grok 4.5',
          readScreen: () => (readable ? 'Cursor Agent' : null),
          write,
          signal: controller.signal
        })
      ).toBe('unknown')
      expect(write).not.toHaveBeenCalled()
    }
  })
})
