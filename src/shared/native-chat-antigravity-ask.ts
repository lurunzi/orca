import type { AskOption, AskPrompt, AskQuestion } from './native-chat/input/native-chat-ask-types'

function parseOption(option: unknown): AskOption | null {
  if (typeof option === 'string') {
    return { label: option }
  }
  if (
    option &&
    typeof option === 'object' &&
    'label' in option &&
    typeof option.label === 'string'
  ) {
    return {
      label: option.label,
      ...('description' in option && typeof option.description === 'string'
        ? { description: option.description }
        : {})
    }
  }
  return null
}

/** Antigravity serializes its questions array inside the tool arguments. */
export function parseAntigravityAskInput(input: unknown): AskPrompt | null {
  if (!input || typeof input !== 'object' || !('questions' in input)) {
    return null
  }
  let questions: unknown = input.questions
  if (typeof questions === 'string') {
    try {
      questions = JSON.parse(questions)
    } catch {
      return null
    }
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    return null
  }
  const parsed: AskQuestion[] = []
  for (const question of questions) {
    if (
      !question ||
      typeof question !== 'object' ||
      typeof question.question !== 'string' ||
      !question.question.trim() ||
      !Array.isArray(question.options)
    ) {
      // Dropping a question or option would shift the terminal's selection indices.
      return null
    }
    const options: (AskOption | null)[] = question.options.map(parseOption)
    if (options.some((option) => option === null)) {
      return null
    }
    parsed.push({
      question: question.question,
      multiSelect: question.is_multi_select === true || question.multiSelect === true,
      options: options.filter((option): option is AskOption => option !== null)
    })
  }
  return { questions: parsed }
}
