import type { AskAnswerKeyGroup, AskAnswerSelection } from './native-chat-ask-answer'
import type { AskPrompt } from './native-chat/input/native-chat-ask-types'

/** Matches captured agy selectors: arrows navigate, Space toggles, Enter advances. */
export function buildAntigravityAskAnswerKeys(
  prompt: AskPrompt,
  selections: AskAnswerSelection[]
): AskAnswerKeyGroup[] {
  const groups: AskAnswerKeyGroup[] = []
  prompt.questions.forEach((question, index) => {
    const selection = selections[index]
    const other = selection?.other?.trim()
    const indices = [...new Set(selection?.indices ?? [])]
      .filter((value) => Number.isInteger(value) && value >= 0 && value < question.options.length)
      .sort((a, b) => a - b)
    if (indices.length === 0 && !other) {
      groups.push({ raw: '\x1b' })
      return
    }
    let row = 0
    const moveTo = (target: number): void => {
      while (row < target) {
        groups.push({ raw: '\x1b[B' })
        row += 1
      }
    }
    if (question.multiSelect) {
      for (const selected of indices) {
        moveTo(selected)
        groups.push({ raw: ' ' })
      }
    }
    if (other) {
      moveTo(question.options.length)
      const text = question.multiSelect
        ? other
        : [...indices.map((selected) => question.options[selected]!.label), other].join(', ')
      groups.push({ raw: '\r' }, { text }, { raw: '\r' })
    } else {
      if (!question.multiSelect) {
        moveTo(indices[0]!)
      }
      groups.push({ raw: '\r' })
    }
  })
  return groups
}
