import type { CatalogModel } from './agent-session-option-catalog'
import type { SessionOptionValue } from './native-chat-session-options'
import { stripAnsiEscapeSequences } from './ansi-escape-sequences'

export function readAntigravityTerminalSessionOptions(
  screen: string | null | undefined,
  models?: readonly CatalogModel[]
): Record<string, SessionOptionValue> | null {
  if (!screen) {
    return null
  }
  const lines = stripAnsiEscapeSequences(screen).replace(/\r\n?/g, '\n').split('\n')
  // The model is the row immediately below the versioned CLI header (captured agy 1.2.14).
  const header = lines.findIndex((line) => /Antigravity CLI\s+\d+\.\d+/.test(line))
  if (header === -1) {
    return null
  }
  const label = lines[header + 1]?.replace(/^[^A-Za-z0-9]+/, '').trim()
  if (!label || !/^(?:Gemini|Claude|GPT)[\w .()-]+$/i.test(label)) {
    return null
  }
  const match = models?.find((model) => model.label.toLowerCase() === label.toLowerCase())
  return { model: match?.id ?? label }
}
