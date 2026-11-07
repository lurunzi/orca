import type { AgentSessionExecutionOptions } from '../../../shared/agent-session/options/agent-session-execution-options'

/** `cursor-agent --list-models` ids fold effort and Fast into the name (`composer-2.5-fast`);
 *  the parameterized ACP picker lists only base ids, so map such an id to its listed base and Fast. */
export function resolveCursorLegacyModel(
  options: AgentSessionExecutionOptions,
  listed: readonly string[]
): AgentSessionExecutionOptions {
  const requested = options.model
  if (!requested || listed.length === 0 || listed.includes(requested)) {
    return options
  }
  if (requested === 'auto' && listed.includes('default')) {
    return { ...options, model: 'default' }
  }
  const unprefixed = requested.replace(/^cursor-/, '')
  const base = listed
    .filter((id) => unprefixed === id || unprefixed.startsWith(`${id}-`))
    .reduce<string | undefined>(
      (longest, id) => (id.length > (longest?.length ?? 0) ? id : longest),
      undefined
    )
  if (!base) {
    return options
  }
  // Effort words differ per model (`xhigh` vs `extra-high`), so only Fast carries over.
  const fast = unprefixed.slice(base.length).split('-').includes('fast')
  return {
    ...options,
    model: base,
    ...(fast && options.fastMode === undefined ? { fastMode: 'true' as const } : {})
  }
}
