import { buildNativeChatPasteBytes } from '../../../../shared/native-chat-paste-bytes'
import {
  cursorModelTarget,
  cursorModelMenu,
  cursorParameterEditor,
  cursorParameterRows,
  cursorParameterChange,
  cursorModelFooterMatches,
  cursorPickerLines
} from './cursor-model-picker'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const UP = `${ESC}[A`

/** Cursor's /model argument is a filter, not a setter, in its parameterized picker. */
export async function switchCursorModel(args: {
  modelId: string
  modelLabel: string
  readScreen: () => string | null
  write: (data: string) => Promise<boolean>
  signal: AbortSignal
}): Promise<'applied' | 'unknown'> {
  const target = cursorModelTarget(args.modelId, args.modelLabel)
  const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 80))
  const screen = (): string => args.readScreen() ?? ''
  const write = async (data: string): Promise<void> => {
    if (args.signal.aborted || !(await args.write(data))) {
      throw new Error('Cursor command canceled.')
    }
  }
  const wait = async (predicate: (value: string) => boolean): Promise<string> => {
    for (let attempt = 0; attempt < 50 && !args.signal.aborted; attempt++) {
      const current = screen()
      if (predicate(current)) {
        return current
      }
      await pause()
    }
    throw new Error('Cursor did not confirm the model selection.')
  }
  const menu = (value: string): boolean => cursorModelMenu(value, target.label)
  const editor = (value: string): boolean => cursorParameterEditor(value, target)
  try {
    if (!target.label || !screen()) {
      return 'unknown'
    }
    await write(buildNativeChatPasteBytes(`/model ${target.label}`))
    await wait(menu)
    // A filtered sibling is not proof of the requested model.
    const selectedRow = (): string | undefined =>
      cursorPickerLines(screen()).find((line) => /^\s*→\s+/.test(line) && !line.includes('/model'))
    const exact = new RegExp(
      `^\\s*→\\s+${target.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s{2,}|\\s*$)`
    )
    const visited = new Set<string>()
    let selected = selectedRow()
    while (selected && !exact.test(selected) && !visited.has(selected) && visited.size < 30) {
      visited.add(selected)
      const previous = selected
      await write(DOWN)
      await wait((value) => menu(value) && selectedRow() !== previous)
      selected = selectedRow()
    }
    if (!selected || !exact.test(selected)) {
      throw new Error('Cursor did not select the exact model.')
    }
    if (selected.includes('Tab to modify')) {
      await write('\t')
      await wait(editor)
      for (let change = 0; change < 8; change++) {
        const rows = cursorParameterRows(screen())
        const wanted = cursorParameterChange(rows, target)
        if (!wanted) {
          break
        }
        const wantedIndex = rows.findIndex((row) => row.key === wanted.key)
        let focused = rows.findIndex((row) => row.focused)
        if (focused < 0) {
          throw new Error('Cursor parameter focus is unknown.')
        }
        let moves = 0
        while (focused !== wantedIndex) {
          if (++moves > rows.length * 2) {
            throw new Error('Cursor parameter focus did not reach the target.')
          }
          const previous = rows[focused].key
          await write(focused < wantedIndex ? DOWN : UP)
          await wait(
            (value) =>
              editor(value) &&
              cursorParameterRows(value).some((row) => row.focused && row.key !== previous)
          )
          focused = cursorParameterRows(screen()).findIndex((row) => row.focused)
          if (focused < 0) {
            throw new Error('Cursor parameter focus was lost.')
          }
        }
        await write('\r')
        await wait(
          (value) =>
            editor(value) &&
            cursorParameterRows(value).some(
              (row) => row.key === wanted.key && row.checked !== wanted.checked
            )
        )
      }
      if (cursorParameterChange(cursorParameterRows(screen()), target)) {
        throw new Error('Cursor parameters did not settle.')
      }
      await write(ESC)
      await wait(menu)
    } else if (target.effort || target.fast || target.thinking || target.context) {
      throw new Error('Cursor model parameters are unavailable.')
    }
    await write('\r')
    await wait(
      (value) =>
        !menu(value) &&
        cursorModelFooterMatches(value, target) &&
        !value.includes(`/model ${target.label}`)
    )
    return 'applied'
  } catch {
    // Only dismiss the exact picker we opened; never send keys to an unrelated dialog.
    if (!args.signal.aborted) {
      if (editor(screen())) {
        await args.write(ESC)
        try {
          await wait(menu)
        } catch {
          return 'unknown'
        }
      }
      if (menu(screen())) {
        await args.write(ESC)
        try {
          await wait((value) => !menu(value))
        } catch {
          return 'unknown'
        }
        if (screen().includes(`/model ${target.label}`)) {
          await args.write(String.fromCharCode(21))
          try {
            await wait((value) => !value.includes(`/model ${target.label}`))
          } catch {
            return 'unknown'
          }
        }
      }
    }
    return 'unknown'
  }
}
