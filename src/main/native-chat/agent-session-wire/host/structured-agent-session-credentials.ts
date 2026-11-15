import { restartStructuredAgentSessionForCredentials } from '../structured-agent-session-credential-restart'
import {
  hostAttachContext,
  type StructuredAgentSessionHostCore
} from './structured-agent-session-host-collaborators'

/** Agent restarts and account homes: the host surface that decides which credentials a child runs with. */
export function createStructuredAgentSessionCredentials(
  core: () => StructuredAgentSessionHostCore
) {
  return {
    /** Stop an idle chat's agent so its next send starts on the current account and settings. */
    restartAgent: (id: string, force: boolean) => core().lifetime.restartAgent(id, force),
    restartAgentForCredentials: (input: unknown) =>
      restartStructuredAgentSessionForCredentials(hostAttachContext(core()), input),
    childAccountHome: (id: string) => core().sessions.get(id)?.child?.accountHome,
    prospectiveAccountHome: (id: string) => {
      const { deps, serialize } = core()
      return serialize(
        id,
        async () => (await deps.launchAccountHome?.(deps.store.requireWritableRecord(id))) ?? null
      )
    }
  }
}
