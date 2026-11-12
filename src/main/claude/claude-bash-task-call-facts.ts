import type { ClaudeBashTaskCall } from './claude-bash-task-calls'
import type { DecodedClaudeTask } from './claude-child-work-evidence'

/** A task keeps what its launching Bash call proved once any frame for it carried that call. */
export function claudeBashTaskCallFacts(
  call: ClaudeBashTaskCall | undefined,
  existing: DecodedClaudeTask | undefined
): Pick<DecodedClaudeTask, 'awaitsAgents' | 'launchedAgent'> {
  return {
    ...(call?.awaitsAgents || existing?.awaitsAgents ? { awaitsAgents: true as const } : {}),
    launchedAgent: call?.launchedAgent ?? existing?.launchedAgent
  }
}
