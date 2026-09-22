// Antigravity (AGY) JSONL line → NativeChatMessage decoder.

import type { NativeChatBlock, NativeChatMessage } from '../../shared/native-chat-types'
import { formatNativeChatFileReference } from '../../shared/agent-image-paste'
import { isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'
import { IMAGE_FILE_EXTENSIONS } from '../../shared/image-file-extensions'
import { IMAGE_PASTE_FOLLOWING_TEXT_SEPARATOR } from '../../shared/image-paste-following-text'
import {
  asRecord,
  extractString,
  parseJsonObject,
  timestampMs
} from '../ai-vault/session-scanner-values'
import { extractAntigravityUserRequest } from '../ai-vault/session-scanner-antigravity-parser'

const TOOL_STEP_TYPES = new Set([
  'RUN_COMMAND',
  'LIST_DIRECTORY',
  'GENERIC',
  'INVOKE_SUBAGENT',
  'VIEW_FILE',
  'CODE_ACTION',
  'GREP_SEARCH',
  'SEARCH_WEB'
])

export function decodeAntigravityTranscriptLine(
  line: string,
  fallbackId: string
): NativeChatMessage | null {
  const record = parseJsonObject(line)
  if (!record) {
    return null
  }

  const timestamp = parseTimestamp(record.created_at ?? record.timestamp)
  const stepIndex =
    typeof record.step_index === 'number'
      ? String(record.step_index)
      : (extractString(record.step_index) ?? extractString(record.id))
  const id = stepIndex ?? fallbackId
  const source = extractString(record.source)
  const type = extractString(record.type)

  if (
    (source === 'USER_EXPLICIT' || source === 'USER') &&
    (type === 'USER_INPUT' || type === 'REQUEST')
  ) {
    const rawContent = extractString(record.content) ?? ''
    const text = extractAntigravityUserRequest(rawContent) || rawContent
    if (!text.trim()) {
      return null
    }
    return {
      id,
      role: 'user',
      blocks: antigravityUserBlocks(text),
      timestamp,
      source: 'transcript'
    }
  }

  if (source === 'MODEL' && type === 'PLANNER_RESPONSE') {
    const blocks: NativeChatBlock[] = []

    const thinking = extractString(record.thinking)
    if (thinking && thinking.trim()) {
      blocks.push({ type: 'text', text: `> *Thinking:*\n${thinking}` })
    }

    const content = extractString(record.content)
    if (content && content.trim()) {
      blocks.push({ type: 'text', text: content })
    }

    if (Array.isArray(record.tool_calls)) {
      for (const call of record.tool_calls) {
        const tool = asRecord(call)
        if (tool) {
          const name = extractString(tool.name) ?? 'tool'
          const input = tool.args ?? tool.arguments ?? tool.input ?? null
          blocks.push({
            type: 'tool-call',
            name,
            input
          })
        }
      }
    }

    if (blocks.length === 0) {
      return null
    }

    return {
      id,
      role: 'assistant',
      blocks,
      timestamp,
      source: 'transcript'
    }
  }

  // Recorded tool steps are MODEL records, not TOOL_RESULT messages.
  if (source === 'MODEL' && type && TOOL_STEP_TYPES.has(type)) {
    const output = extractString(record.content)
    if (!output) {
      return null
    }
    const isError =
      record.status === 'ERROR' || (typeof record.exit_code === 'number' && record.exit_code !== 0)
    return {
      id,
      role: 'tool',
      blocks: [{ type: 'tool-result', output, ...(isError ? { isError: true } : {}) }],
      timestamp,
      source: 'transcript'
    }
  }

  return null
}

function parseTimestamp(value: unknown): number | null {
  const parsed = timestampMs(value)
  return Number.isFinite(parsed) ? parsed : null
}

function antigravityUserBlocks(text: string): NativeChatBlock[] {
  const blocks: NativeChatBlock[] = []
  let remaining = text
  // Antigravity persists Orca's image pastes as leading file references.
  while (remaining.startsWith('@')) {
    const reference = remaining.match(
      /^@(?:"((?:\\"|[^"\\\r\n]|\\(?!"))*)"|'([^'\r\n]*)'|([^\s]+))(?=\s|$)/
    )
    if (!reference) {
      break
    }
    const path = reference[1]?.replace(/\\"/g, '"') ?? reference[2] ?? reference[3] ?? ''
    if (
      !(path.startsWith('/') || isWindowsAbsolutePathLike(path)) ||
      !IMAGE_FILE_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension)) ||
      formatNativeChatFileReference(path) !== reference[0]
    ) {
      break
    }
    blocks.push({ type: 'image-ref', path })
    remaining = remaining.slice(reference[0].length)
    if (remaining.startsWith(IMAGE_PASTE_FOLLOWING_TEXT_SEPARATOR)) {
      remaining = remaining.slice(IMAGE_PASTE_FOLLOWING_TEXT_SEPARATOR.length)
    }
  }
  if (remaining) {
    blocks.push({ type: 'text', text: remaining })
  }
  return blocks
}
