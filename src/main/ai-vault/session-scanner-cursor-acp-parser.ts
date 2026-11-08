import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { AiVaultSession } from '../../shared/ai-vault-types'
import { wslGatedStat } from '../native-chat/wsl-transcript-fs-access'
import { readCursorAcpStore } from './cursor-acp-session-store'
import { createAccumulator, finalizeSession, timestampIso } from './session-scanner-accumulator'
import { consumeCursorRecord } from './session-scanner-cursor-parser'
import { extractGrokFirstUserPromptText } from './session-scanner-grok-user-text'
import { asRecord } from './session-scanner-record-value'
import { normalizeTitleText } from './session-scanner-text-normalization'
import type { FileWithMtime } from './session-scanner-types'
import type { TranscriptMessageSink } from './session-transcript-consumers'
import { extractString, readJsonObjectIfExists } from './session-scanner-values'

// `cursor-agent acp` writes <config>/acp-sessions/<id>/{meta.json,store.db}, never agent-transcripts.
export const CURSOR_ACP_SESSIONS_DIR = 'acp-sessions'
const CURSOR_ACP_META_FILE = 'meta.json'
const CURSOR_ACP_STORE_FILE = 'store.db'

export function isCursorAcpSessionMetaPath(filePath: string): boolean {
  const segments = filePath.split(/[\\/]+/)
  return segments.at(-1) === CURSOR_ACP_META_FILE && segments.at(-3) === CURSOR_ACP_SESSIONS_DIR
}

/** `cursor-agent --resume` reads <config>/chats, so an ACP id would start an empty chat under that id. */
export function assertNotCursorAcpTerminalResume(agent: string, filePath: string): void {
  if (agent === 'cursor' && isCursorAcpSessionMetaPath(filePath)) {
    throw new Error(
      'This Cursor conversation was created in an Orca chat and cannot be resumed in a terminal.'
    )
  }
}

/** Watch the WAL when present: turns commit there long before a checkpoint touches store.db. */
export async function cursorAcpStoreDependencyPath(metaPath: string): Promise<string> {
  const dbPath = join(dirname(metaPath), CURSOR_ACP_STORE_FILE)
  try {
    await wslGatedStat(`${dbPath}-wal`, 'scan')
    return `${dbPath}-wal`
  } catch {
    return dbPath
  }
}

export async function parseCursorAcpSessionFile(
  file: FileWithMtime,
  platform: NodeJS.Platform = process.platform,
  messages?: TranscriptMessageSink
): Promise<AiVaultSession | null> {
  const meta = await readJsonObjectIfExists(file.path)
  if (!meta) {
    return null
  }
  const dbPath = join(dirname(file.path), CURSOR_ACP_STORE_FILE)
  // A chat created but never sent has no store yet; SQLite failures otherwise surface as scan issues.
  const store = existsSync(dbPath) ? readCursorAcpStore(dbPath) : null
  const accumulator = createAccumulator({
    agent: 'cursor',
    file,
    sessionId: basename(dirname(file.path)),
    messages
  })
  for (const message of store?.messages ?? []) {
    const role = extractString(message.role)
    if (role === 'user') {
      // Bootstrap user_info rows and task notifications are not conversation turns.
      const text = extractGrokFirstUserPromptText(message.content)
      if (text && !/<system_notification>/i.test(text)) {
        consumeCursorRecord(accumulator, { role, content: text })
      }
    } else if (role === 'assistant' && Array.isArray(message.content)) {
      accumulator.model = assistantModel(message.content) ?? accumulator.model
      if (message.content.some((part) => asRecord(part)?.type === 'text')) {
        consumeCursorRecord(accumulator, message)
      }
    }
  }
  accumulator.cwd = extractString(meta.cwd)
  const title = extractString(meta.title) ?? store?.name ?? null
  accumulator.title = (title ? normalizeTitleText(title) : null) ?? accumulator.title
  accumulator.createdAt = store?.createdAtMs ? timestampIso(store.createdAtMs) : null
  const sidecarMtimeMs = typeof file.sidecar === 'object' ? file.sidecar.mtimeMs : 0
  accumulator.updatedAt = timestampIso(Math.max(file.mtimeMs, sidecarMtimeMs))
  return finalizeSession(accumulator, platform)
}

function assistantModel(content: unknown[]): string | null {
  for (const part of content) {
    const cursor = asRecord(asRecord(asRecord(part)?.providerOptions)?.cursor)
    const model = extractString(cursor?.modelName)
    if (model) {
      return model
    }
  }
  return null
}
