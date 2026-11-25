/** The Orca mode `current` reports; Orca's own Full access runs the agent in its ask mode, so an ask
 *  report under it reads as Full access. */
export function acpReportedPermissionMode(
  values: Readonly<Partial<Record<string, string>>>,
  current: string | undefined,
  appliedPermissionMode: string | undefined
): string | null {
  const mode = current
    ? (Object.entries(values).find(([, value]) => value === current)?.[0] ?? null)
    : null
  return mode === 'ask' && appliedPermissionMode === 'full-access' ? 'full-access' : mode
}

/** The agent's value for the wanted mode, or a refusal; Orca answers approvals itself for a Full
 *  access the agent lacks, running it in ask mode. */
export function requireAcpPermissionModeValue(
  values: Readonly<Partial<Record<string, string>>> | undefined,
  wanted: string,
  agentName: string
): string {
  const value = values?.[wanted] ?? (wanted === 'full-access' ? values?.ask : undefined)
  if (value === undefined) {
    throw new Error(`${agentName} on this host cannot run in the ${wanted} permission mode`)
  }
  return value
}
