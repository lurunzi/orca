/** One version of a paired-runtime file; a changed size or mtime is a different cache entry. */
export type DragOutEntryKey = {
  environmentId: string
  worktreeId: string
  relativePath: string
  size: number
  mtime: number
}

export type DragOutBeginResult =
  | { status: 'started' | 'writing' | 'complete'; entryId: string }
  | { status: 'rejected' }

export const DRAG_OUT_MAX_ENTRY_BYTES = 64 * 1024 * 1024

export type DragOutApi = {
  begin: (args: { key: DragOutEntryKey; name: string }) => Promise<DragOutBeginResult>
  append: (args: { entryId: string; contentBase64: string }) => Promise<{ ok: true }>
  finish: (args: { entryId: string }) => Promise<{ ok: true }>
  cancel: (args: { entryId: string }) => Promise<{ ok: true }>
  /** Replaces the HTML5 drag with an OS file drag of the cached copy. */
  start: (args: { entryId: string }) => Promise<{ ok: true; filePath: string }>
}
