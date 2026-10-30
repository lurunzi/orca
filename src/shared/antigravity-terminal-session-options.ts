import type { CatalogModel } from './agent-session-option-catalog'
import type { SessionOptionValue } from './native-chat/input/native-chat-session-options'
import { stripAnsiEscapeSequences } from './ansi-escape-sequences'

export function readAntigravityTerminalSessionOptions(
  screen: string | null | undefined,
  models?: readonly CatalogModel[]
): Record<string, SessionOptionValue> | null {
  if (!screen) {
    return null
  }
  const lines = stripAnsiEscapeSequences(screen).replace(/\r\n?/g, '\n').split('\n')
  const header = lines.findIndex((line) => /Antigravity CLI\s+\d+\.\d+/.test(line))
  if (header === -1) {
    return null
  }
  // An account row ("Gemini API key", or an email on agy 1.3.3) may sit between the
  // header and the model row; the versioned model name is what tells them apart.
  const label = lines
    .slice(header + 1, header + 3)
    .map((line) => line.replace(/^[^A-Za-z0-9]+/, '').trim())
    .find((line) => /^(?:Gemini|Claude|GPT)[\w .()-]+$/i.test(line) && /\d/.test(line))
  if (!label) {
    return null
  }
  const match = models?.find((model) => model.label.toLowerCase() === label.toLowerCase())
  return { model: match?.id ?? label }
}
