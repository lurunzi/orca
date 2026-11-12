import { z } from 'zod'
import {
  isValidAgentSessionQuestionAnswers,
  legacyAgentSessionQuestionAnswers
} from '../../../shared/agent-session/agent-session-question-answer'
import { boundJournalPromptBody } from '../../native-chat/agent-session-journal/item-lifecycle/journal-prompt-body-bounds'
import { AcpRpcError } from '../transport/acp-errors'
import { pendingAcpResolution } from './acp-dialect'
import type { AcpRequestPresentation, AcpRequestSettlement } from './acp-dialect'

// Shapes follow cursor-agent 2026.11.05's ACP interaction handlers and cursor.com/docs/cli/acp.
export const CURSOR_ASK_QUESTION = 'cursor/ask_question'
export const CURSOR_CREATE_PLAN = 'cursor/create_plan'
// Sent as requests whose replies cursor-agent ignores (it only logs failures).
const CURSOR_REPORTS = ['cursor/update_todos', 'cursor/task', 'cursor/generate_image']

export const CURSOR_SESSIONLESS_REQUESTS = [
  CURSOR_ASK_QUESTION,
  CURSOR_CREATE_PLAN,
  ...CURSOR_REPORTS
]

const questionRequestSchema = z.object({
  toolCallId: z.string().optional(),
  title: z.string().nullish(),
  questions: z
    .array(
      z.object({
        id: z.string().min(1),
        prompt: z.string(),
        options: z.array(z.object({ id: z.string().min(1), label: z.string() })),
        allowMultiple: z.boolean().nullish()
      })
    )
    .min(1)
})
const planRequestSchema = z.object({
  name: z.string().nullish(),
  overview: z.string().nullish(),
  plan: z.string().nullish()
})

const CANCELLED = { outcome: { outcome: 'cancelled' } }

function questionRequest(params: unknown): AcpRequestPresentation {
  const parsed = questionRequestSchema.safeParse(params)
  if (!parsed.success) {
    throw new AcpRpcError(-32602, 'Invalid Cursor question request')
  }
  const questions = parsed.data.questions.map((question) => ({
    id: question.id,
    question: question.prompt,
    multiSelect: question.allowMultiple ?? false,
    options: question.options.map((option) => ({ id: option.id, label: option.label }))
  }))
  const body = boundJournalPromptBody({
    kind: 'question' as const,
    question: parsed.data.title?.trim() || questions[0]!.question,
    options: questions[0]!.options,
    questions,
    resolution: pendingAcpResolution
  })
  return {
    body,
    reply: (response) => {
      if (response === null) {
        return CANCELLED
      }
      const answers =
        response.kind === 'answers'
          ? response.answers
          : legacyAgentSessionQuestionAnswers(body, response.optionId)
      // Cursor takes offered choices only; ACP has no free-text answer.
      if (
        !answers ||
        answers.some((answer) => answer.other?.trim()) ||
        !isValidAgentSessionQuestionAnswers(questions, answers)
      ) {
        throw new AcpRpcError(-32602, 'Question answer must choose offered options')
      }
      return {
        outcome: {
          outcome: 'answered',
          answers: answers.map((answer) => ({
            questionId: answer.questionId,
            selectedOptionIds: answer.optionIds
          }))
        }
      }
    }
  }
}

const PLAN_OPTIONS = [
  { id: 'accept', label: 'Approve plan' },
  { id: 'reject', label: 'Keep planning' }
]

function planRequest(params: unknown): AcpRequestPresentation {
  const parsed = planRequestSchema.safeParse(params)
  if (!parsed.success) {
    throw new AcpRpcError(-32602, 'Invalid Cursor plan request')
  }
  const { name, overview, plan } = parsed.data
  const body = boundJournalPromptBody({
    kind: 'approval' as const,
    title: name?.trim() || 'Review proposed plan',
    ...(overview?.trim() ? { description: overview.trim() } : {}),
    subject: { kind: 'plan' as const, text: plan ?? '' },
    detail: null,
    options: PLAN_OPTIONS.map((option) => ({ ...option })),
    resolution: pendingAcpResolution
  })
  return {
    body,
    reply: (response) => {
      if (response === null) {
        return CANCELLED
      }
      if (response.kind !== 'option' || !PLAN_OPTIONS.some(({ id }) => id === response.optionId)) {
        throw new AcpRpcError(-32602, 'Plan answer must approve or keep planning')
      }
      return response.optionId === 'accept'
        ? { outcome: { outcome: 'accepted' } }
        : { outcome: { outcome: 'rejected', reason: 'The user chose to keep planning' } }
    }
  }
}

export function cursorRequest(method: string, params: unknown): AcpRequestPresentation | undefined {
  if (method === CURSOR_ASK_QUESTION) {
    return questionRequest(params)
  }
  return method === CURSOR_CREATE_PLAN ? planRequest(params) : undefined
}

export function cursorSettleRequest(method: string): AcpRequestSettlement | undefined {
  return CURSOR_REPORTS.includes(method) ? { reply: {} } : undefined
}
