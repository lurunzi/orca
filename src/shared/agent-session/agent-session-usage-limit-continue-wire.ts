/** Host-derived automatic-continue schedule for a chat's latest usage-limit cut. */
export type AgentSessionUsageLimitContinueState = {
  turnItemId: string
  resetsAt: number
  state: 'scheduled' | 'cancelled' | 'failed' | 'off'
  /** When the account's own usage says the limit lasts past `resetsAt`; the send waits for it. */
  continueAt?: number
}
