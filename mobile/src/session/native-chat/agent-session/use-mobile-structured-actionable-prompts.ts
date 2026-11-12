import { useMemo } from 'react'
import {
  actionableStructuredApproval,
  actionableStructuredQuestion
} from '../input/mobile-structured-actionable-prompt'

/** The approval and question still awaiting an answer, and what currently refuses a command. */
export function useMobileStructuredActionablePrompts(
  state: Parameters<typeof actionableStructuredApproval>[0],
  turnId: string | null,
  queueSendsNext: boolean
) {
  const { items, currentRequests, actionablePromptIds } = state
  // Prefer host actionability: ended-agent prompts must receive no answer.
  const [approvalPrompt, questionPrompt] = useMemo(() => {
    const prompts = { items, currentRequests, actionablePromptIds }
    return [actionableStructuredApproval(prompts), actionableStructuredQuestion(prompts)] as const
  }, [items, currentRequests, actionablePromptIds])
  const commandRefusalCauses = useMemo(
    () => ({
      working: turnId !== null || queueSendsNext,
      prompt: approvalPrompt !== null || questionPrompt !== null
    }),
    [approvalPrompt, questionPrompt, queueSendsNext, turnId]
  )
  return { approvalPrompt, questionPrompt, commandRefusalCauses }
}
