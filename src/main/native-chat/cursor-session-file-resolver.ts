import { basename } from 'node:path'
import { isWslUncPath } from '../../shared/wsl-paths'
import { walkSessionFiles } from '../ai-vault/session-scanner-discovery'
import { AI_VAULT_AGENT_SOURCES } from '../ai-vault/session-scanner-agent-sources'
import { wslGatedReaddir } from './wsl-transcript-fs-access'
import { wslTranscriptFsRefusal, type WslTranscriptFsError } from './wsl-transcript-fs-gate'

/** Finds `<session id>.jsonl` under Cursor projects roots, then under lazily loaded WSL roots. */
export async function resolveCursorSessionFile(
  sessionId: string,
  projectsDirs: string[],
  loadFallbackDirs?: () => Promise<string[]>,
  signal?: AbortSignal
): Promise<string | null> {
  const hit = await findCursorTranscriptInDirs(sessionId, projectsDirs, signal)
  if (hit || !loadFallbackDirs) {
    return hit
  }
  signal?.throwIfAborted()
  const fallbackDirs = (await loadFallbackDirs()).filter((dir) => !projectsDirs.includes(dir))
  signal?.throwIfAborted()
  return findCursorTranscriptInDirs(sessionId, fallbackDirs, signal)
}

async function findCursorTranscriptInDirs(
  sessionId: string,
  projectsDirs: string[],
  signal?: AbortSignal
): Promise<string | null> {
  const source = AI_VAULT_AGENT_SOURCES.cursor
  const targetName = `${sessionId}.jsonl`
  let unavailable: WslTranscriptFsError | undefined
  for (const rootDir of projectsDirs) {
    const isWslRoot = isWslUncPath(rootDir)
    try {
      const files = await walkSessionFiles(rootDir, 'cursor', [], {
        extensions: new Set(source.extensions),
        directoryPredicate: source.directoryPredicate,
        filePredicate: (path) =>
          basename(path) === targetName && (source.filePredicate?.(path) ?? true),
        ...(isWslRoot
          ? { readDirectory: (dirPath: string) => wslGatedReaddir(dirPath, 'scan', signal) }
          : {}),
        signal
      })
      if (files[0]) {
        return files[0]
      }
    } catch (error) {
      signal?.throwIfAborted()
      unavailable = wslTranscriptFsRefusal(error)
    }
  }
  if (unavailable) {
    throw unavailable
  }
  return null
}
