import type { StructuredAgentSessionAtRestCommands } from '../options/structured-agent-session-at-rest-commands'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import type { StructuredAgentRegistry } from './structured-agent-registry'

/** Routes each at-rest read to the record's provider; change listeners span every adapter. */
export function routeStructuredAgentSessionAtRestCommands(
  agents: () => Pick<StructuredAgentRegistry, 'registration'>,
  adapters: () => StructuredAgentSessionAdapter[]
): StructuredAgentSessionAtRestCommands {
  const source = (provider: string) => agents().registration(provider)?.adapter.atRestCommands
  return {
    read: (record) => source(record.provider)?.read(record),
    snapshot: (record) =>
      source(record.provider)?.snapshot?.(record) ?? {
        commandsPending: false
      },
    settled: async (record, budgetMs, independent) => {
      const commands = source(record.provider)
      return commands?.settled
        ? commands.settled(record, budgetMs, independent)
        : commands?.read(record)
    },
    onChange: (listener) => {
      const stops = adapters().flatMap((adapter) =>
        adapter.atRestCommands ? [adapter.atRestCommands.onChange(listener)] : []
      )
      return () => stops.forEach((stop) => stop())
    }
  }
}
