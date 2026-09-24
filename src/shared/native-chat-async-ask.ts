// Codex `request_user_input_async`: a question the agent asks without blocking.
// Its tool result (`{"accepted":true}`) only acknowledges delivery; the user's
// reply arrives later as an ordinary user message, never as TUI keystrokes.

import type { AskAnswerSelection, AskPrompt, AskQuestion } from './native-chat-ask-types'
import { isInterruptedStatusMessage, type NativeChatMessage } from './native-chat-types'

export const CODEX_ASYNC_ASK_TOOL_NAME = 'request_user_input_async'

export function isAsyncAskUserQuestionTool(toolName: string | undefined): boolean {
  return toolName?.replaceAll(/[^a-z0-9]/gi, '').toLowerCase() === 'requestuserinputasync'
}

function readField(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value
    ? Reflect.get(value, key)
    : undefined
}

/** `{questions:[{title, options?: string[]}]}`; arguments may arrive JSON-encoded. */
export function parseAsyncAskInput(input: unknown): AskPrompt | null {
  let value = input
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  const rawQuestions = readField(value, 'questions')
  if (!Array.isArray(rawQuestions)) {
    return null
  }
  const questions: AskQuestion[] = []
  for (const raw of rawQuestions) {
    const titleField = readField(raw, 'title')
    const title = typeof titleField === 'string' ? titleField : readField(raw, 'question')
    if (typeof title !== 'string' || title.trim().length === 0) {
      continue
    }
    const rawOptions = readField(raw, 'options')
    const options = Array.isArray(rawOptions)
      ? rawOptions.filter((option): option is string => typeof option === 'string')
      : []
    questions.push({
      question: title,
      multiSelect: false,
      options: options.map((label) => ({ label }))
    })
  }
  return questions.length > 0 ? { questions } : null
}

/** Newest async question not yet superseded by a user turn or an interrupt.
 *  Tool results are ignored on purpose: they are the acknowledgement, not the answer. */
export function extractPendingAsyncAsk(messages: readonly NativeChatMessage[]): AskPrompt | null {
  let pending: AskPrompt | null = null
  for (const message of messages) {
    if (message.role === 'user' || isInterruptedStatusMessage(message)) {
      pending = null
    }
    for (const block of message.blocks) {
      if (block.type === 'tool-call' && isAsyncAskUserQuestionTool(block.name)) {
        pending = parseAsyncAskInput(block.input) ?? pending
      }
    }
  }
  return pending
}

function answerText(question: AskQuestion, selection: AskAnswerSelection | undefined): string {
  const labels = (selection?.indices ?? [])
    .map((index) => question.options[index]?.label ?? '')
    .filter((label) => label.length > 0)
  const other = (selection?.other ?? '').trim()
  return (other ? [...labels, other] : labels).join(', ')
}

/** The follow-up user message: the bare answer for one question, `Q:`/`A:` pairs otherwise. */
export function formatAsyncAskAnswer(prompt: AskPrompt, selections: AskAnswerSelection[]): string {
  if (prompt.questions.length === 1) {
    return answerText(prompt.questions[0]!, selections[0])
  }
  return prompt.questions
    .map((question, index) => ({ question, answer: answerText(question, selections[index]) }))
    .filter(({ answer }) => answer.length > 0)
    .map(({ question, answer }) => `Q: ${question.question}\nA: ${answer}`)
    .join('\n\n')
}
