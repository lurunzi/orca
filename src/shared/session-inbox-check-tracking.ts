// Each check's latest result, and how a later run or edit changes it. Adapted from petekp/inbox
// `hooks/check-tracking.ts` (https://github.com/petekp/inbox @ a8ee58e, MIT, Copyright (c) 2026
// Pete Petrash); license: resources/licenses/petekp-inbox/LICENSE.

import type { SessionInboxCheckKind } from './session-inbox-check-types'
import type { SessionInboxCheck } from './session-inbox-types'
import { isPathInsideOrEqual, normalizeRuntimePathForComparison } from './cross-platform-path'

type CheckIdentity = Pick<SessionInboxCheck, 'folder' | 'name' | 'target'>

/** The one identity rule: a check is its name, its folder and, when it narrows anything, its target. */
export function sessionInboxCheckKey(check: CheckIdentity): string {
  const { paths, filters } = check.target
  const key = `${check.folder === null ? '.' : normalizeRuntimePathForComparison(check.folder)}:${check.name}`
  return paths.length === 0 && filters.length === 0
    ? key
    : `${key}:${JSON.stringify([paths.map(normalizeRuntimePathForComparison).sort(), [...filters].sort()])}`
}

/** Whether the folder `path` is, or contains, `inner`. */
export function sessionInboxPathContains(path: string, inner: string): boolean {
  return isPathInsideOrEqual(path, inner)
}

export function sessionInboxSamePath(a: string, b: string): boolean {
  return normalizeRuntimePathForComparison(a) === normalizeRuntimePathForComparison(b)
}

function sameFolder(a: string | null, b: string | null): boolean {
  return a === null || b === null ? a === b : sessionInboxSamePath(a, b)
}

/**
 * Whether `run` covers `result`: the same check in the same folder, with no filters or the same
 * ones, and no paths or paths that contain every path the result has (which must have some).
 */
function covers(run: CheckIdentity, result: CheckIdentity): boolean {
  if (run.name !== result.name || !sameFolder(run.folder, result.folder)) {
    return false
  }
  const a = run.target
  const b = result.target
  const isSameFilters =
    a.filters.length === b.filters.length && a.filters.every((filter) => b.filters.includes(filter))
  const hasPaths =
    b.paths.length > 0 &&
    b.paths.every((inner) => a.paths.some((outer) => sessionInboxPathContains(outer, inner)))
  return (a.filters.length === 0 || isSameFilters) && (a.paths.length === 0 || hasPaths)
}

/**
 * Keeps each check's latest result. A run replaces every result it covers, and a check script
 * that passes, such as check.sh, replaces every earlier result in its folder.
 */
export function recordSessionInboxCheck(
  results: readonly SessionInboxCheck[],
  check: SessionInboxCheck
): SessionInboxCheck[] {
  const isAll = check.kind === 'all' && check.result === 'pass'
  return [
    ...results.filter(
      (earlier) => !(covers(check, earlier) || (isAll && sameFolder(earlier.folder, check.folder)))
    ),
    check
  ]
}

/** Markdown matters only to a lint, a validation or a check script. */
function readsFile(kind: SessionInboxCheckKind, path: string): boolean {
  return kind === 'lint' || kind === 'validate' || kind === 'all' || !/\.md$/i.test(path)
}

/**
 * A file at `path` changed. A result goes stale when the file is in its folder (`root` for the
 * session's own); with no known root, every edit can be in it.
 */
export function sessionInboxChecksAfterEdit(
  results: readonly SessionInboxCheck[],
  path: string,
  root: string | null
): SessionInboxCheck[] {
  return results.map((check) => {
    if (check.isStale || !readsFile(check.kind, path)) {
      return check
    }
    const folder = check.folder ?? root
    const isInFolder = folder === null || sessionInboxPathContains(folder, path)
    return isInFolder ? { ...check, isStale: true } : check
  })
}
