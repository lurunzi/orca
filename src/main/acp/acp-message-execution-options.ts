import {
  providerDiagnostic,
  withProviderDiagnostic
} from '../../shared/agent-session/failures/agent-session-failure'
import type { AgentSessionExecutionOptions } from '../../shared/agent-session/options/agent-session-execution-options'
import { AgentSessionOptionRejectedError } from '../native-chat/agent-session-wire/structured-agent-session-option-error'
import { AcpAgentError } from './acp-errors'
import type { AcpStructuredSession } from './acp-structured-session'
import {
  acpAuthenticationRequired,
  acpPromptErrorDetail,
  acpSignInRequiredFailure
} from './acp-turn-failures'

export async function applyAcpMessageOptions(
  session: AcpStructuredSession,
  requested: AgentSessionExecutionOptions | undefined,
  setOption: (key: 'model' | 'effort' | 'fastMode', value: string) => Promise<unknown>,
  isCurrent: () => boolean,
  signal?: AbortSignal
): Promise<boolean> {
  if (!requested) {
    return true
  }
  const options =
    session.spec.dialect.resolveModelSelection?.(requested, session.options.listedModelIds()) ??
    requested
  // Fast follows the model, so it is written after the model switch.
  const keys = session.spec.dialect.fastOptionId
    ? (['model', 'effort', 'fastMode'] as const)
    : (['model', 'effort'] as const)
  for (const key of keys) {
    const value = options[key]
    if (value === undefined || session.options.appliedInput.get(key) === value) {
      continue
    }
    try {
      await setOption(key, value)
    } catch (error) {
      signal?.throwIfAborted()
      if (!isCurrent()) {
        return false
      }
      // A saved effort or Fast pick rides along with a named model that may not offer it (Composer has no effort).
      if (
        key !== 'model' &&
        options.model !== undefined &&
        !(error instanceof AcpAgentError) &&
        session.options.write(key, value) === null
      ) {
        continue
      }
      if (error instanceof AcpAgentError) {
        const detail = acpPromptErrorDetail(session.spec.dialect, error)
        const rejection = acpAuthenticationRequired(session.spec.dialect, error)
          ? acpSignInRequiredFailure(session.spec.dialect, error)
          : undefined
        throw withProviderDiagnostic(
          new AgentSessionOptionRejectedError(error, 'optionRejected', rejection),
          providerDiagnostic(detail, 'person')
        )
      }
      throw new AgentSessionOptionRejectedError(error)
    }
    if (!isCurrent()) {
      return false
    }
  }
  return true
}
