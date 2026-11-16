/** Orca's own Full access runs the agent in its ask mode, so an ask report under it reads as Full access. */
export function acpReportedFullAccessMode(
  mode: string | null,
  appliedPermissionMode: string | undefined
): string | null {
  return mode === 'ask' && appliedPermissionMode === 'full-access' ? 'full-access' : mode
}
