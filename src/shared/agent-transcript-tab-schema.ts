import { z } from 'zod'

export const agentTranscriptTabSchema = z.object({
  agent: z.literal('cursor'),
  sessionId: z.string().min(1),
  transcriptPath: z.string().min(1),
  runtimeEnvironmentId: z.string().min(1).nullable()
})
