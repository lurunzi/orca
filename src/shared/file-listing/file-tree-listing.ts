/** One entry of a recursive folder listing, relative to the listed folder with `/` separators. */
export type FileTreeListEntry = {
  relativePath: string
  isDirectory: boolean
  /** Bytes for files; 0 for directories. */
  size: number
}

export type FileTreeListSkip = {
  relativePath: string
  /** Symlinks are never followed, so a link cannot pull in files from outside the folder. */
  reason: 'symlink' | 'special'
}

/** Parents always precede their children, so a client can create directories in order. */
export type FileTreeListResult = {
  entries: FileTreeListEntry[]
  skipped: FileTreeListSkip[]
  totalBytes: number
}

export const FILE_TREE_LIST_RUNTIME_CAPABILITY = 'files.listTree.v1' as const
export const FILE_TREE_LIST_MAX_ENTRIES = 20_000
export const FILE_TREE_LIST_MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024
export const FILE_TREE_LIST_TOO_LARGE_MESSAGE = 'folder_too_large'
