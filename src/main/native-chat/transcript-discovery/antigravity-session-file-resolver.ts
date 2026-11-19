import { homedir } from 'node:os'
import { join } from 'node:path'
import { isWslUncPath } from '../../../shared/file-access/wsl-paths'
import { wslGatedAccess } from '../transcript-filesystem/wsl-transcript-fs-access'
import { WslTranscriptFsError } from '../transcript-filesystem/wsl-transcript-fs-error'
import { admitWslTranscriptPath } from '../transcript-filesystem/wsl-transcript-running-admission'

/** Antigravity CLI keeps each conversation at `<brain>/<id>/.system_generated/logs/transcript.jsonl`. */
export async function resolveAntigravitySessionFile(
  sessionId: string,
  brainDir: string | undefined,
  signal?: AbortSignal
): Promise<string | null> {
  // A conversation id is one directory segment, never a caller-supplied path.
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    return null
  }
  const path = join(
    brainDir ?? join(homedir(), '.gemini', 'antigravity-cli', 'brain'),
    sessionId,
    '.system_generated',
    'logs',
    'transcript.jsonl'
  )
  signal?.throwIfAborted()
  if (process.platform === 'win32' && isWslUncPath(path)) {
    // A stopped or unverifiable distro is a refusal the pane can show, never a missing file.
    await admitWslTranscriptPath(path)
  }
  try {
    return (await wslGatedAccess(path, 'exact', signal)) ? path : null
  } catch (error) {
    if (error instanceof WslTranscriptFsError || signal?.aborted) {
      throw error
    }
    return null
  }
}
