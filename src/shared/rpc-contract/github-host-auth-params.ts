import * as z from 'zod'
import { lazyZodSchema } from '../schema/lazy-zod-schema'

// Why no token field: gh writes the credential on the host; a client never sends or reads one.
export const GitHubHostAuthStartParams = lazyZodSchema(() =>
  z.object({
    /** Ends a sign-in another client left running on this host and starts a new one. */
    replace: z.boolean().optional()
  })
)

export const GitHubHostAuthFlowParams = lazyZodSchema(() =>
  z.object({ flowId: z.string().min(1).max(64) })
)

export const GitHubHostAuthWaitParams = lazyZodSchema(() =>
  GitHubHostAuthFlowParams.extend({
    afterRevision: z.number().int().nonnegative().default(0)
  })
)
