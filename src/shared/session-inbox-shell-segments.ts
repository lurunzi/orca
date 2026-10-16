// The pieces of a shell command that run in turn, and their words. Adapted from petekp/inbox `hooks/checks.ts`
// (https://github.com/petekp/inbox @ a8ee58e, MIT, Copyright (c) 2026 Pete Petrash);
// license: resources/licenses/petekp-inbox/LICENSE.

/**
 * A piece of a shell command and the operator after it: `&&`, `||`, `;`, a newline, `|`, or ''
 * at the end. `text` has quoted strings and substitutions blanked to `""`, so
 * `git commit -m "fix tsc"` names no tsc; `written` keeps them, for reading the paths it names.
 */
export type ShellSegment = { text: string; written: string; next: string }

/** A redirect word, such as `>`, `2>&1` or `<in.txt`. */
export const REDIRECT = /^(?:\d*|&)[<>]|^&$/

/**
 * The pieces of a shell command that run one after another or in a pipe, with heredoc bodies and
 * comments removed and continued lines joined. A command substitution stays inside its piece, so
 * `-xctestrun $(ls *.xctestrun | head -1)` is not a pipe.
 */
export function shellSegments(command: string): ShellSegment[] {
  const quoted: string[] = []
  const substituted: string[] = []
  // Private-use characters mark what was masked; commands do not contain them.
  let masked = command
    .replace(/<<-?\s*(["']?)(\w+)\1[^\n]*\n[\s\S]*?\n\2\b/g, ' ')
    // One pass, so a quote inside a comment and a `#` inside quotes read as bash reads them.
    .replace(/"(?:\\[\s\S]|[^"\\])*"|'[^']*'|(^|[\s;&|(])#[^\n]*/g, (match, before?: string) =>
      before === undefined ? `\uE000${quoted.push(match) - 1}\uE000` : before
    )
    .replace(/\\\n/g, ' ')
  // Innermost first, so a substitution inside another one is masked too.
  for (let before = ''; before !== masked;) {
    before = masked
    masked = masked.replace(
      /\$\([^()]*\)|`[^`]*`/g,
      (s) => `\uE001${substituted.push(s) - 1}\uE001`
    )
  }
  const unmask = (part: string, isKept: boolean): string => {
    let out = part
    while (/\uE001\d+\uE001/.test(out)) {
      out = out.replace(/\uE001(\d+)\uE001/g, (_, n: string) =>
        isKept ? (substituted[Number(n)] ?? '') : '""'
      )
    }
    return out
      .replace(/\uE000(\d+)\uE000/g, (_, n: string) => (isKept ? (quoted[Number(n)] ?? '') : '""'))
      .trim()
  }
  const parts = masked.split(/(&&|\|\||;|\n|\|)/)
  const found: ShellSegment[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const part = parts[i] ?? ''
    const text = unmask(part, false)
    if (text) {
      found.push({ text, written: unmask(part, true), next: parts[i + 1] ?? '' })
    }
  }
  return found
}

/**
 * A segment without the shell syntax and variable assignments before its command, such as `if !`
 * in `if ! pgrep -x xcodebuild`, `do`, or `CI=1`.
 */
export function commandOf(segment: string): string {
  return segment.replace(
    /^(?:[({]\s*|!\s+|(?:if|then|elif|else|do|while|until|time)\s+|[A-Za-z_]\w*=(?:"(?:\\[\s\S]|[^"\\])*"|'[^']*'|[^\s"'])*\s+)+/,
    ''
  )
}

/** A segment's words, with their quotes removed. */
export function wordsOf(segment: string): string[] {
  return (segment.match(/(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s"']+)+/g) ?? []).map((word) =>
    word.replace(
      /"((?:\\.|[^"\\])*)"|'([^']*)'/g,
      (_, double?: string, single?: string) => double ?? single ?? ''
    )
  )
}
