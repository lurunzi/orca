// Canonical AskUserQuestion prompt types consumed by the shared parser and both
// native-chat platform UIs.

export type AskOption = { label: string; description?: string }
export type AskQuestion = {
  question: string
  header?: string
  multiSelect: boolean
  options: AskOption[]
}
export type AskPrompt = { questions: AskQuestion[] }

/** One question's chosen answer, normalized for delivery: the selected option
 *  indices (in option order) plus any free-text "other" answer. Index-based (not
 *  label text) so the answer can be delivered by the selector's stable option
 *  number — see `buildAskAnswerKeys`. */
export type AskAnswerSelection = { indices: number[]; other?: string }

/** A parser turns one agent's interactive-question tool input into the normalized
 *  AskPrompt the card renders. */
export type InteractiveQuestionParser = (input: unknown) => AskPrompt | null
