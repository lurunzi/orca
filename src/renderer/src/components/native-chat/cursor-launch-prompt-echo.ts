import { normalizeNativeChatUserText } from '../../../../shared/native-chat-image-transcript-markers'
import { getUtf8ByteLengthForCodePoint } from '../../../../shared/utf8-byte-limits'

/** Match the captured Cursor transcript damage: one UTF-8 character became one replacement per byte. */
export function matchesCursorLaunchPromptEcho(sent: string, recorded: string): boolean {
  const expected = normalizeNativeChatUserText(sent)
  const actual = normalizeNativeChatUserText(recorded)
  if (expected === actual) {
    return true
  }
  const damaged = actual.match(/\uFFFD{2,4}/u)
  if (
    expected.length < 128 ||
    !damaged ||
    damaged.index === undefined ||
    expected.includes('\uFFFD')
  ) {
    return false
  }
  const at = damaged.index
  const codePoint = expected.codePointAt(at)
  if (codePoint === undefined || codePoint < 0x80) {
    return false
  }
  const character = String.fromCodePoint(codePoint)
  return (
    getUtf8ByteLengthForCodePoint(codePoint) === damaged[0].length &&
    expected.slice(0, at) === actual.slice(0, at) &&
    expected.slice(at + character.length) === actual.slice(at + damaged[0].length)
  )
}
