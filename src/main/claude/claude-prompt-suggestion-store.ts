import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const SCHEMA_VERSION = 1
const MAX_ENTRIES = 200

type Entry = { suggestion: string; leafUuid: string; savedAt: number }

/** One session's view of the store. */
export type ClaudePromptSuggestionMemory = {
  save: (suggestion: string, leafUuid: string | null) => void
  forget: () => void
  /** The saved suggestion, only while the session still resumes at the leaf it followed. */
  restore: (leafUuid: string | null) => string | null
}

export type ClaudePromptSuggestionStore = {
  memory: (sessionId: string) => ClaudePromptSuggestionMemory
  flush: () => Promise<void>
}

function parseEntries(value: unknown): Map<string, Entry> {
  const entries = new Map<string, Entry>()
  if (typeof value !== 'object' || value === null || !('entries' in value)) {
    return entries
  }
  const rows = value.entries
  if (typeof rows !== 'object' || rows === null) {
    return entries
  }
  for (const [sessionId, row] of Object.entries(rows)) {
    if (
      typeof row === 'object' &&
      row !== null &&
      'suggestion' in row &&
      'leafUuid' in row &&
      'savedAt' in row &&
      typeof row.suggestion === 'string' &&
      typeof row.leafUuid === 'string' &&
      typeof row.savedAt === 'number'
    ) {
      entries.set(sessionId, {
        suggestion: row.suggestion,
        leafUuid: row.leafUuid,
        savedAt: row.savedAt
      })
    }
  }
  return entries
}

/** Claude only emits a suggestion after a live turn, so a restart would otherwise lose it. */
export async function loadClaudePromptSuggestionStore(
  directory: string,
  now: () => number = Date.now
): Promise<ClaudePromptSuggestionStore> {
  const filePath = join(directory, 'claude-prompt-suggestions.json')
  let entries = new Map<string, Entry>()
  try {
    entries = parseEntries(JSON.parse(await readFile(filePath, 'utf8')))
  } catch {
    // Missing or malformed: start empty.
  }
  let writing = Promise.resolve()
  const persist = (): void => {
    const snapshot = Object.fromEntries(entries)
    writing = writing.then(async () => {
      try {
        await mkdir(dirname(filePath), { recursive: true })
        const tmpPath = `${filePath}.tmp`
        await writeFile(tmpPath, JSON.stringify({ version: SCHEMA_VERSION, entries: snapshot }))
        await rename(tmpPath, filePath)
      } catch {
        // Bookkeeping only; the live session keeps its suggestion this run.
      }
    })
  }
  return {
    memory: (sessionId) => ({
      save(suggestion, leafUuid) {
        if (leafUuid === null) {
          return
        }
        entries.delete(sessionId)
        entries.set(sessionId, { suggestion, leafUuid, savedAt: now() })
        while (entries.size > MAX_ENTRIES) {
          const oldest = entries.keys().next().value
          if (oldest === undefined) {
            break
          }
          entries.delete(oldest)
        }
        persist()
      },
      forget() {
        if (entries.delete(sessionId)) {
          persist()
        }
      },
      restore(leafUuid) {
        const entry = entries.get(sessionId)
        return entry && leafUuid !== null && entry.leafUuid === leafUuid ? entry.suggestion : null
      }
    }),
    flush: () => writing
  }
}
