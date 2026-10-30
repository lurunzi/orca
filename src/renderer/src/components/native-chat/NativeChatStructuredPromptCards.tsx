import type { ComponentProps, RefObject } from 'react'
import { agentSessionPromptQuestions } from '../../../../shared/agent-session-question-answer'
import { chatApprovalFromJournal } from '../../../../shared/native-chat-interactive-prompt'
import { NativeChatApprovalCard } from './NativeChatApprovalCard'
import { NativeChatStructuredQuestionCard } from './NativeChatStructuredQuestionCard'
import { structuredPromptCancel } from './structured-prompt-cancel'
import type { useStructuredPromptResponseHold } from './use-structured-prompt-response-hold'

type PromptController = Parameters<typeof structuredPromptCancel>[0]

type NativeChatStructuredPromptCardsProps = Pick<
  ComponentProps<typeof NativeChatApprovalCard>,
  'onLinkClick' | 'allowFileUriLinks'
> & {
  controller: PromptController
  prompt: PromptController['prompts'][number]
  agent: string
  response: ReturnType<typeof useStructuredPromptResponseHold>
  shouldFocus: boolean
  answerInputRef: RefObject<HTMLInputElement | null>
}

/** The shown structured prompt as its approval or question card. */
export function NativeChatStructuredPromptCards({
  controller,
  prompt,
  agent,
  response,
  shouldFocus,
  answerInputRef,
  ...fileLinkProps
}: NativeChatStructuredPromptCardsProps): React.JSX.Element {
  const approval = prompt.body.kind === 'approval' ? chatApprovalFromJournal(prompt.body) : null
  const questionBody = prompt.body.kind === 'question' ? prompt.body : null
  const cancelPrompt = structuredPromptCancel(controller, prompt, agent)
  return (
    <>
      {approval ? (
        <NativeChatApprovalCard
          key={`${prompt.itemId}:${prompt.revision}`}
          approval={approval}
          onChoose={(optionId) => void response.respond(prompt, { kind: 'option', optionId })}
          isSubmitting={response.holds(prompt)}
          onCancel={cancelPrompt}
          shouldFocus={shouldFocus}
          {...fileLinkProps}
        />
      ) : null}
      {questionBody ? (
        <NativeChatStructuredQuestionCard
          key={`${prompt.itemId}:${prompt.revision}`}
          questions={agentSessionPromptQuestions(questionBody)}
          onAnswer={(answer) => void response.respond(prompt, answer)}
          isSubmitting={response.holds(prompt)}
          onCancel={cancelPrompt}
          shouldFocus={shouldFocus}
          answerInputRef={answerInputRef}
        />
      ) : null}
    </>
  )
}
