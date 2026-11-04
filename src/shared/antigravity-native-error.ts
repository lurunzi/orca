export type AntigravityNativeError = { id: string; text: string }

const ERROR_ID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}-\d+$/i

/** A completed native error has an error identifier above agy's empty composer. */
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
    .filter((line) => line && !/^[\u2500\u2501-]+$/.test(line))
  const warning = above.findLastIndex((line) => /^\u26A0\uFE0F?\s+/.test(line))
  if (warning === -1) {
    return null
  }
  const content = above.slice(warning).join(' ')
  const marker = /\b(?:ErrID|Error ID):\s*([\da-f\s-]+)$/i.exec(content)
  if (!marker) {
    return null
  }
  const id = marker[1]!.replace(/\s/g, '')
  const message = content
    .slice(0, marker.index)
    .replace(/^\u26A0\uFE0F?\s+/, '')
    .trim()
  return ERROR_ID.test(id) && message ? { id, text: `${message}\nErrID: ${id}` } : null
}
