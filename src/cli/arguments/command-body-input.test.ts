import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readTextOrFileFlag } from './command-body-input'
import { looksLikeGbkDecodedUtf8 } from './garbled-utf8-text'

const ORIGINAL =
  '所有者确认了你前面的思路，要求：“出个方案给我”。\n请你编写一份完整的方案（Markdown）。'
// Output of Windows PowerShell 5.1 (code page 936) running `Get-Content -Raw`
// on the first line of ORIGINAL saved as BOM-less UTF-8 (private-use
// characters it also emits are dropped here).
const GARBLED = '鎵€鏈夎€呯‘璁や簡浣犲墠闈㈢殑鎬濊矾锛岃姹傦細鈥滃嚭涓柟妗堢粰鎴戔€濄€?璇蜂綘缂栧啓'

describe('looksLikeGbkDecodedUtf8', () => {
  it('flags UTF-8 decoded as GBK', () => {
    expect(looksLikeGbkDecodedUtf8(GARBLED)).toBe(true)
  })

  it('accepts genuine Chinese, English and mixed text', () => {
    expect(looksLikeGbkDecodedUtf8(ORIGINAL)).toBe(false)
    expect(looksLikeGbkDecodedUtf8('Fix the Dashboard — price is €5, “quoted”…')).toBe(false)
    expect(looksLikeGbkDecodedUtf8('中文“引号”、顿号。还有…省略号（括号）')).toBe(false)
  })
})

describe('readTextOrFileFlag garbled input', () => {
  it('refuses a garbled inline flag and points at the file flag', async () => {
    const flags = new Map<string, string | boolean>([['spec', GARBLED]])
    await expect(readTextOrFileFlag(flags, process.cwd(), 'spec', true)).rejects.toThrow(
      /--spec looks garbled.*--spec-file <path>/
    )
  })

  it('passes clean inline text through unchanged', async () => {
    const flags = new Map<string, string | boolean>([['spec', ORIGINAL]])
    await expect(readTextOrFileFlag(flags, process.cwd(), 'spec', true)).resolves.toBe(ORIGINAL)
  })

  it('reads a named UTF-8 file as-is, even when it quotes garbled text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orca-body-input-'))
    const path = join(dir, 'spec.md')
    await writeFile(path, `${ORIGINAL}\n${GARBLED}`, 'utf8')
    const flags = new Map<string, string | boolean>([['spec-file', path]])
    await expect(readTextOrFileFlag(flags, dir, 'spec', true)).resolves.toBe(
      `${ORIGINAL}\n${GARBLED}`
    )
  })
})
