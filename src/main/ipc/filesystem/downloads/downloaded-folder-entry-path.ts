import { isAbsolute, join, relative, sep } from 'node:path'
import { sanitizeLocalDownloadFilename } from './local-download-filename'

export const INVALID_FOLDER_ENTRY_NAME_MESSAGE = 'invalid_entry_name'

/**
 * Maps a host-supplied `a/b/c` path to a path inside `stagingRoot`, or throws.
 * Names are not rewritten: a name this OS cannot hold is refused, so two remote names never collide locally.
 */
export function resolveDownloadedFolderEntryPath(
  stagingRoot: string,
  relativePath: string
): string {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.length > 4096) {
    throw new Error(INVALID_FOLDER_ENTRY_NAME_MESSAGE)
  }
  const segments = relativePath.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(INVALID_FOLDER_ENTRY_NAME_MESSAGE)
    }
    // A name the local sanitizer would change is one this filesystem would misread (separators, `:`, reserved).
    if (sanitizeLocalDownloadFilename(segment) !== segment) {
      throw new Error(INVALID_FOLDER_ENTRY_NAME_MESSAGE)
    }
  }
  const candidate = join(stagingRoot, ...segments)
  const fromRoot = relative(stagingRoot, candidate)
  if (!fromRoot || isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(INVALID_FOLDER_ENTRY_NAME_MESSAGE)
  }
  return candidate
}

/** `name`, then `name (1)`, `name (2)`…: an existing folder is never merged into or replaced. */
export function downloadedFolderNameCandidate(name: string, attempt: number): string {
  return attempt === 0 ? name : `${name} (${attempt})`
}
