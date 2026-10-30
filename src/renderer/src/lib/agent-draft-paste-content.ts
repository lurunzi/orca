import { yieldToEventLoop } from '../../../shared/event-loop-yield'
import {
  getUtf8ByteLengthForCodePoint,
  readUtf8CodePointAt
} from '../../../shared/utf8-byte-limits'
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  encodeWindowsInputRecordPasteText,
  normalizeTerminalPasteLineEndings,
  wrapTerminalBracketedPasteText
} from '@/components/terminal-pane/terminal-bracketed-paste'
import type { WindowsInputRecordNewline } from '@/components/terminal-pane/terminal-paste-model'
import { runTerminalPtyInputTransaction } from '@/components/terminal-pane/terminal-pty-input-transaction'
import { sendRuntimePtyInputVerified } from '@/runtime/runtime-terminal-verified-input'
import type { TerminalInputKind } from '../../../shared/terminal-input-kind'

// Bracketed paste keeps generated prompts together without triggering per-character TUI edits.
export const AGENT_DRAFT_PASTE_DIRECT_MAX_BYTES = 64 * 1024
export const AGENT_DRAFT_PASTE_CHUNK_MAX_BYTES = 16 * 1024
export const AGENT_DRAFT_PASTE_MAX_BYTES = 16 * 1024 * 1024
const AGENT_DRAFT_PASTE_PREFLIGHT_YIELD_CODE_UNITS = 256 * 1024
const AGENT_DRAFT_PASTE_ESCAPE_CODE_POINT = 0x1b
const AGENT_DRAFT_PASTE_INERT_ESCAPE_CODE_POINT = 0x241b
const AGENT_DRAFT_PASTE_INERT_ESCAPE = '\u241b'

export type AgentDraftPtyInputWriter = (data: string) => boolean | Promise<boolean>

export async function sendAgentDraftPasteContent(
  ptyId: string,
  content: string,
  inputKind: TerminalInputKind,
  writePty?: AgentDraftPtyInputWriter
): Promise<boolean> {
  return await runTerminalPtyInputTransaction(ptyId, () =>
    sendAgentDraftPasteContentNow(ptyId, content, inputKind, writePty)
  )
}

// Callers owning the larger paste/Enter transaction must hold the lock; reacquiring here would deadlock.
export async function sendAgentDraftPasteContentNow(
  ptyId: string,
  content: string,
  inputKind: TerminalInputKind,
  writePty?: AgentDraftPtyInputWriter,
  windowsInputRecordNewline?: WindowsInputRecordNewline
): Promise<boolean> {
  if (content.length > AGENT_DRAFT_PASTE_MAX_BYTES) {
    return false
  }

  const terminalContent = normalizeTerminalPasteLineEndings(content)
  const directMeasurement = measureSanitizedUtf8ByteLength(terminalContent, {
    stopAfterBytes: AGENT_DRAFT_PASTE_DIRECT_MAX_BYTES,
    windowsInputRecordNewline
  })
  if (!directMeasurement.exceededLimit) {
    return await writeAgentDraftPtyInput(
      ptyId,
      windowsInputRecordNewline
        ? encodeWindowsInputRecordPasteText(terminalContent, windowsInputRecordNewline)
        : wrapTerminalBracketedPasteText(terminalContent),
      inputKind,
      writePty
    )
  }

  // Yield during size preflight so large generated prompts cannot pin the renderer before PTY writes.
  if (
    await isSanitizedDraftPasteOverLimit(
      terminalContent,
      AGENT_DRAFT_PASTE_MAX_BYTES,
      windowsInputRecordNewline
    )
  ) {
    return false
  }

  let bracketedPasteOpen = false
  for (const chunk of iterateAgentDraftPasteContentChunks(
    terminalContent,
    AGENT_DRAFT_PASTE_CHUNK_MAX_BYTES,
    windowsInputRecordNewline
  )) {
    let accepted = false
    try {
      accepted = await writeAgentDraftPtyInput(ptyId, chunk, inputKind, writePty)
    } catch {
      if (bracketedPasteOpen && chunk !== BRACKETED_PASTE_END) {
        await closeAgentDraftBracketedPaste(ptyId, inputKind, writePty)
      }
      return false
    }
    if (!accepted) {
      if (bracketedPasteOpen && chunk !== BRACKETED_PASTE_END) {
        await closeAgentDraftBracketedPaste(ptyId, inputKind, writePty)
      }
      return false
    }
    if (chunk === BRACKETED_PASTE_START) {
      bracketedPasteOpen = true
    } else if (chunk === BRACKETED_PASTE_END) {
      bracketedPasteOpen = false
    }
  }
  return true
}

export function chunkAgentDraftPasteContent(
  content: string,
  maxChunkBytes = AGENT_DRAFT_PASTE_CHUNK_MAX_BYTES
): string[] {
  return [...iterateAgentDraftPasteContentChunks(content, maxChunkBytes)]
}

export function* iterateAgentDraftPasteContentChunks(
  content: string,
  maxChunkBytes = AGENT_DRAFT_PASTE_CHUNK_MAX_BYTES,
  windowsInputRecordNewline?: WindowsInputRecordNewline
): Generator<string> {
  const newline = windowsInputRecordNewline
    ? encodeWindowsInputRecordPasteText('\n', windowsInputRecordNewline)
    : null
  const safeMaxChunkBytes = Math.max(4, newline?.length ?? 0, maxChunkBytes)
  if (!windowsInputRecordNewline) {
    yield BRACKETED_PASTE_START
  }
  // Normalize before chunking so split CRLF cannot leak an LF to Windows ConPTY.
  const terminalContent = normalizeTerminalPasteLineEndings(content)
  let chunk = ''
  let chunkBytes = 0

  for (let index = 0; index < terminalContent.length; index += 1) {
    const codePoint = readUtf8CodePointAt(terminalContent, index)
    const codeUnitLength = codePoint > 0xffff ? 2 : 1
    const sanitizedEscape = codePoint === AGENT_DRAFT_PASTE_ESCAPE_CODE_POINT
    const sanitized =
      codePoint === 0x0d && newline
        ? newline
        : sanitizedEscape
          ? AGENT_DRAFT_PASTE_INERT_ESCAPE
          : terminalContent.slice(index, index + codeUnitLength)
    const characterBytes = getSanitizedUtf8ByteLengthForCodePoint(
      codePoint,
      windowsInputRecordNewline
    )
    if (chunk && chunkBytes + characterBytes > safeMaxChunkBytes) {
      yield chunk
      chunk = sanitized
      chunkBytes = characterBytes
      if (codeUnitLength === 2) {
        index += 1
      }
      continue
    }
    chunk += sanitized
    chunkBytes += characterBytes
    if (codeUnitLength === 2) {
      index += 1
    }
  }

  if (chunk) {
    yield chunk
  }
  if (!windowsInputRecordNewline) {
    yield BRACKETED_PASTE_END
  }
}

type SanitizedDraftPasteByteMeasurement = {
  byteLength: number
  exceededLimit: boolean
}

function measureSanitizedUtf8ByteLength(
  content: string,
  options: { stopAfterBytes?: number; windowsInputRecordNewline?: WindowsInputRecordNewline } = {}
): SanitizedDraftPasteByteMeasurement {
  let byteLength = 0
  const stopAfterBytes = options.stopAfterBytes
  for (let index = 0; index < content.length; index += 1) {
    const codePoint = readUtf8CodePointAt(content, index)
    byteLength += getSanitizedUtf8ByteLengthForCodePoint(
      codePoint,
      options.windowsInputRecordNewline
    )
    if (Number.isFinite(stopAfterBytes) && byteLength > (stopAfterBytes ?? 0)) {
      return { byteLength, exceededLimit: true }
    }
    if (codePoint > 0xffff) {
      index += 1
    }
  }
  return { byteLength, exceededLimit: false }
}

async function isSanitizedDraftPasteOverLimit(
  content: string,
  maxBytes: number,
  windowsInputRecordNewline?: WindowsInputRecordNewline
): Promise<boolean> {
  let byteLength = 0
  let nextYieldAt = AGENT_DRAFT_PASTE_PREFLIGHT_YIELD_CODE_UNITS
  for (let index = 0; index < content.length; index += 1) {
    const codePoint = readUtf8CodePointAt(content, index)
    byteLength += getSanitizedUtf8ByteLengthForCodePoint(codePoint, windowsInputRecordNewline)
    if (byteLength > maxBytes) {
      return true
    }
    if (codePoint > 0xffff) {
      index += 1
    }
    if (index >= nextYieldAt) {
      await yieldToEventLoop()
      nextYieldAt = index + AGENT_DRAFT_PASTE_PREFLIGHT_YIELD_CODE_UNITS
    }
  }
  return false
}

function getSanitizedUtf8ByteLengthForCodePoint(
  codePoint: number,
  windowsInputRecordNewline?: WindowsInputRecordNewline
): number {
  if (codePoint === 0x0d && windowsInputRecordNewline) {
    return windowsInputRecordNewline === 'csi-u' ? 7 : 2
  }
  return getUtf8ByteLengthForCodePoint(
    codePoint === AGENT_DRAFT_PASTE_ESCAPE_CODE_POINT
      ? AGENT_DRAFT_PASTE_INERT_ESCAPE_CODE_POINT
      : codePoint
  )
}

async function writeAgentDraftPtyInput(
  ptyId: string,
  data: string,
  inputKind: TerminalInputKind,
  writePty?: AgentDraftPtyInputWriter
): Promise<boolean> {
  return writePty ? await writePty(data) : await sendRuntimePtyInputVerified(ptyId, data, inputKind)
}

async function closeAgentDraftBracketedPaste(
  ptyId: string,
  inputKind: TerminalInputKind,
  writePty?: AgentDraftPtyInputWriter
): Promise<void> {
  try {
    // Close bracketed-paste mode even after a content write fails.
    await writeAgentDraftPtyInput(ptyId, BRACKETED_PASTE_END, inputKind, writePty)
  } catch {
    // The original write already failed; callers only need the paste to fail closed.
  }
}
