import { Lexer, type Token } from 'marked'
import { isNoiseMessage } from './native-chat-noise'
import { nativeChatProseToMarkdown } from './native-chat-prose'
import type { AskPrompt } from './native-chat-ask-types'
import type { NativeChatMessage } from './native-chat-types'

function inlineText(tokens: readonly Token[]): string {
  return tokens
    .map((token) => {
      if ('tokens' in token && Array.isArray(token.tokens)) {
        return inlineText(token.tokens)
      }
      return 'text' in token && typeof token.text === 'string' ? token.text : ''
    })
    .join('')
}

/** Only a final prose request; tables, examples and tool selectors are not choices. */
export function extractAntigravityProseQuestion(
  messages: readonly NativeChatMessage[]
): { prompt: AskPrompt; sourceMessageId: string } | null {
  const latest = messages.findLast((message) => !isNoiseMessage(message))
  if (latest?.role !== 'assistant' || latest.blocks.some((block) => block.type === 'tool-call')) {
    return null
  }
  const last = Lexer.lex(nativeChatProseToMarkdown(latest.blocks)).findLast(
    (token) => token.type !== 'space'
  )
  if (last?.type !== 'paragraph' || !Array.isArray(last.tokens)) {
    return null
  }
  const question = inlineText(last.tokens).trim()
  const explicitRequest =
    /(?:请(?:你|您)?(?:告诉|确认|选择|提供|说明|回复|指定)|(?:告诉|回复)我|\b(?:please\s+(?:tell|confirm|choose|select|provide|specify)|let me know)\b)/i.test(
      question
    )
  if (!explicitRequest && !/[?？]["'”’）)]*$/.test(question)) {
    return null
  }
  return {
    sourceMessageId: latest.id,
    prompt: { questions: [{ question, multiSelect: false, options: [] }] }
  }
}
