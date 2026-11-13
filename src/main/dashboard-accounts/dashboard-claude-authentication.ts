import { z } from 'zod'
import { DashboardAllocationError } from './dashboard-allocation-protocol'

const InitializationSourceSchema = z.object({
  account: z.object({
    tokenSource: z.literal('CLAUDE_CODE_OAUTH_TOKEN'),
    apiKeySource: z.literal('none').optional()
  })
})

export function assertDashboardClaudeAuthenticationSource(initialization: unknown): void {
  if (!InitializationSourceSchema.safeParse(initialization).success) {
    throw new DashboardAllocationError()
  }
}
