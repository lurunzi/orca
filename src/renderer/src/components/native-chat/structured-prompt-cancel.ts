import type { useStructuredAgentSession } from './use-structured-agent-session'

type StructuredPromptController = Pick<
  ReturnType<typeof useStructuredAgentSession>,
  'turnId' | 'cancel' | 'prompts'
>

/** Cancels the shown prompt's turn; Pi prompts can be cancelled without a turn id. */
export function structuredPromptCancel(
  controller: StructuredPromptController,
  prompt: StructuredPromptController['prompts'][number] | null,
  agent: string
): () => void {
  return () => {
    if (prompt && (controller.turnId || agent === 'pi')) {
      void controller.cancel(controller.turnId ?? undefined, {
        itemId: prompt.itemId,
        expectedRevision: prompt.revision
      })
    }
  }
}
