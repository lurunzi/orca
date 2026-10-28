import type { AgentSessionCurrentRequestsMarker } from './agent-session-current-requests-wire'
import type { AgentSessionQueuePublicationFields } from './agent-session-queued-message-wire'

/** Published-frame host wall clock (epoch ms per AgentSessionHistoryPage) and queuedMessages companions. */
export type AgentSessionFrameFields = {
  hostNow?: number
  /** Version of the independent current-request read; absent from older hosts. */
  currentRequests?: AgentSessionCurrentRequestsMarker
  /** Fork: ephemeral composer text; omission preserves it, null clears it. */
  promptSuggestion?: string | null
} & AgentSessionQueuePublicationFields
