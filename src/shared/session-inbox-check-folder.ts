// The folder a shell command runs a check in. Adapted from petekp/inbox `hooks/checks.ts`
// (https://github.com/petekp/inbox @ a8ee58e, MIT, Copyright (c) 2026 Pete Petrash);
// license: resources/licenses/petekp-inbox/LICENSE.

import { REDIRECT, commandOf, wordsOf, type ShellSegment } from './session-inbox-shell-segments'

/** A word's path with `~` and HOME expanded; null when another variable or a substitution hides it. */
export type ExpandWord = (word: string) => string | null

const isAbsolute = (path: string) => /^(?:[A-Za-z]:)?[\\/]/.test(path)

/**
 * `path` resolved against the folder `from`: `/`-separated, with `.` and `..` worked out and a
 * drive letter in capitals. Git Bash drive paths are translated only with a proven drive cwd.
 */
export function resolvePath(from: string, path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const target = /^[A-Za-z]:[\\/]/.test(from)
    ? slashed.replace(/^\/([A-Za-z])(?=\/|$)/, '$1:')
    : slashed
  const base = from.replace(/\\/g, '/').replace(/\/+$/, '')
  const joined = isAbsolute(target) ? target : `${base}/${target}`
  const drive = /^[A-Za-z]:/.exec(joined)?.[0] ?? ''
  // A UNC path, such as `//wsl.localhost/Ubuntu/home`, keeps both leading slashes.
  const root = drive ? `${drive.toUpperCase()}/` : (/^\/\/(?=[^/])/.exec(joined)?.[0] ?? '/')
  const parts: string[] = []
  for (const part of joined.slice(drive.length).split('/')) {
    if (part === '..') {
      parts.pop()
    } else if (part && part !== '.') {
      parts.push(part)
    }
  }
  return `${root}${parts.join('/')}`
}

/** Whether a folder is a temporary one, where a throwaway copy of a project lives. */
export function isTemporary(folder: string): boolean {
  const path = folder.replace(/\\/g, '/')
  return (
    /^(?:\/private)?\/(?:tmp|var\/tmp|var\/folders)(?:\/|$)/.test(path) ||
    // Windows' own temp folders, by drive or as Git Bash's `/c/...`.
    /^(?:[a-z]:|\/[a-z])\/(?:users\/[^/]+\/appdata\/local\/temp|windows\/temp)(?:\/|$)/i.test(path)
  )
}

/** Expands `~` and HOME to `home`. */
export function homeExpander(home: string): ExpandWord {
  return (word) => {
    if (/\$\(|`/.test(word)) {
      return null
    }
    const out = word
      .replace(/^~(?=[\\/]|$)/, () => home)
      .replace(/\$(?:HOME\b|\{HOME\})/g, () => home)
    return out.includes('$') ? null : out
  }
}

/** `path` resolved from `folder`; null when either is hidden, unless the path is absolute. */
export function resolveFrom(folder: string | null, path: string | null): string | null {
  if (path === null || (folder === null && !isAbsolute(path))) {
    return null
  }
  return resolvePath(folder ?? '/', path)
}

/** Where `cd` with these words moves the shell from `folder`: home when they name no folder. */
function cdTarget(words: string[], folder: string | null, expand: ExpandWord): string | null {
  const dir = words.slice(1).find((w) => !/^-[LPe@]+$|^--$/.test(w) && !REDIRECT.test(w)) ?? '~'
  // `cd -` goes back to a folder the command does not show.
  return dir === '-' ? null : resolveFrom(folder, expand(dir))
}

/**
 * The folder the shell is in when segment `at` starts: `start`, moved by each `cd` before it. A
 * `cd` inside parentheses lasts until they close, and one piped into a command moves nothing.
 */
export function folderBefore(
  segments: ShellSegment[],
  at: number,
  start: string,
  expand: ExpandWord
): string | null {
  let folder: string | null = start
  const enclosing: { folder: string | null }[] = []
  for (const { text, written, next } of segments.slice(0, at)) {
    for (let opens = text.split('(').length - 1; opens > 0; opens--) {
      enclosing.push({ folder })
    }
    if (/^cd(?:\s|$)/.test(commandOf(text)) && next !== '|') {
      folder = cdTarget(wordsOf(commandOf(written)), folder, expand)
    }
    for (let closes = text.split(')').length - 1; closes > 0; closes--) {
      const outer = enclosing.pop()
      if (outer) {
        folder = outer.folder
      }
    }
  }
  return folder
}

/** Options that name the folder a check runs in, as in `npm --prefix app test`. */
const FOLDER_OPTIONS = new Set([
  '--prefix',
  '-C',
  '--cwd',
  '--dir',
  '--directory',
  '--package-path',
  '--manifest-path'
])
/**
 * The folder the words after a check's runner name, as in `claude plugin test <folder>` or
 * `npm --prefix <folder> test`, and the positions of the words that name it.
 */
export function namedFolder(
  after: string[],
  runner: string
): { named: string | undefined; folderWords: Set<number> } {
  const folderWords = new Set<number>()
  let named: string | undefined
  if (runner === 'claude') {
    // The first word after `plugin test` that is not an option or a redirect.
    const j = after.findIndex((w, k) => k >= 2 && !/^-|^\d*[<>&]/.test(w))
    if (j !== -1) {
      named = after[j]
      folderWords.add(j)
    }
  }
  for (const [j, w] of after.entries()) {
    const isInline = w.startsWith('--') && w.includes('=')
    const [option = '', value] = isInline ? w.split(/=(.*)/s) : [w, after[j + 1]]
    if (FOLDER_OPTIONS.has(option) && value !== undefined) {
      named = value
      folderWords.add(j)
      if (!isInline) {
        folderWords.add(j + 1)
      }
    }
  }
  // A project file, such as tsconfig.build.json or Cargo.toml, names its folder.
  if (named && /\.(?:json|toml)$/.test(named)) {
    named = named.replace(/[\\/]?[^\\/]*$/, '') || '.'
  }
  return { named, folderWords }
}
