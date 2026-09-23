import path from 'node:path'
import { realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

import { getAppEnvironment, hasAppEnvironment } from '../../shared/app-environment'

const CLIPBOARD_IMAGE_TEMP_FILE_NAME =
  /^orca-paste-\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i

export function createClipboardImageTempFileName(): string {
  return `orca-paste-${Date.now()}-${randomUUID()}.png`
}

function localTempDirs(): string[] {
  if (!hasAppEnvironment()) {
    return []
  }
  const tempDir = path.resolve(getAppEnvironment().getPath('temp'))
  try {
    // Why: read authorization re-checks the realpath (macOS /private, Windows 8.3 names).
    const realTempDir = path.resolve(realpathSync(tempDir))
    return realTempDir === tempDir ? [tempDir] : [tempDir, realTempDir]
  } catch {
    return [tempDir]
  }
}

/**
 * Why: the per-paste read grant lives in memory, so after a restart or update transcripts
 * still name pasted images Orca wrote but can no longer preview. Recognise them by name + dir.
 */
export function isLocalClipboardImageTempFile(resolvedTarget: string): boolean {
  if (!CLIPBOARD_IMAGE_TEMP_FILE_NAME.test(path.basename(resolvedTarget))) {
    return false
  }
  const parent = path.dirname(resolvedTarget)
  return localTempDirs().some((tempDir) => path.relative(tempDir, parent) === '')
}
