export type AntigravityNativeError = { id: string; text: string }

const ERROR_ID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}-\d+$/i

/** A native error ends with ErrID immediately above agy's empty composer. */
export function readAntigravityNativeError(
  lines: readonly string[]
): AntigravityNativeError | null {
  const composer = lines.findLastIndex((line) => /^\s*>/.test(line))
  if (composer === -1 || lines[composer]!.trim() !== '>') {
    return null
  }
  const above = lines
    .slice(Math.max(0, composer - 20), composer)
    .map((line) => line.trim())
    .filter((line) => line && !/^[─━-]+$/.test(line))
  const warning = above.findLastIndex((line) => /^⚠\uFE0F?\s+/.test(line))
  if (warning === -1) {
    return null
  }
  const content = above.slice(warning).join(' ')
  const marker = content.lastIndexOf('ErrID:')
  if (marker === -1) {
    return null
  }
  const id = content.slice(marker + 'ErrID:'.length).replace(/\s/g, '')
  const message = content
    .slice(0, marker)
    .replace(/^⚠\uFE0F?\s+/, '')
    .trim()
  return ERROR_ID.test(id) && message ? { id, text: `${message}\nErrID: ${id}` } : null
}
