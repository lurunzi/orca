import type { RefObject } from 'react'
import { agentSessionPromptQuestions } from '../../../../shared/agent-session/agent-session-question-answer'
import { chatApprovalFromJournal } from '../../../../shared/native-chat/input/native-chat-interactive-prompt'
import { NativeChatApprovalCard } from './prompts/NativeChatApprovalCard'
import { NativeChatStructuredQuestionCard } from './prompts/NativeChatStructuredQuestionCard'
import { cancelStructuredPrompt } from './session/structured/writes/native-chat-structured-stop-controls'
import type { useStructuredPromptResponseHold } from './prompts/use-structured-prompt-response-hold'
import type { useStructuredAgentSession } from './session/structured/use-structured-agent-session'

type PromptController = Parameters<typeof cancelStructuredPrompt>[0] &
  Pick<ReturnType<typeof useStructuredAgentSession>, 'prompts'>

type NativeChatStructuredPromptCardsProps = {
  controller: PromptController
  prompt: PromptController['prompts'][number]
  response: ReturnType<typeof useStructuredPromptResponseHold>
  shouldFocus: boolean
  answerInputRef: RefObject<HTMLTextAreaElement | null>
}

/** The shown structured prompt as its approval or question card. */
export function NativeChatStructuredPromptCards({
  controller,
  prompt,
  response,
  shouldFocus,
  answerInputRef
}: NativeChatStructuredPromptCardsProps): React.JSX.Element {
  const approval = prompt.body.kind === 'approval' ? chatApprovalFromJournal(prompt.body) : null
  const questionBody = prompt.body.kind === 'question' ? prompt.body : null
  const cancelPrompt = () => cancelStructuredPrompt(controller, prompt)
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
