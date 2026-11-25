import { useMemo } from 'react'

/** What currently refuses a slash command: a running turn or an open approval/question. */
export function useStructuredCommandRefusalCauses(
  prompts: { approvalPrompt: unknown; questionPrompt: unknown },
  turnId: string | null,
  queueSendsNext: boolean
) {
  const { approvalPrompt, questionPrompt } = prompts
  return useMemo(
    () => ({
      working: turnId !== null || queueSendsNext,
      prompt: approvalPrompt !== null || questionPrompt !== null
    }),
    [approvalPrompt, questionPrompt, queueSendsNext, turnId]
  )
}
