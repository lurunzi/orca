import type * as ComposerMetadata from './structured-agent-session-composer-metadata'
import type { CurrentRequestsSubscriber } from './agent-session-current-requests'
import type { AgentJournalCursor } from '../../../shared/agent-session-journal-types'
import type { AgentSessionSubscribeEvent } from '../../../shared/agent-session-wire'
import type {
  SubscriberFieldHooks,
  SubscriberFieldState
} from './agent-session-subscriber-frame-fields'
import type { QueuePublication } from './structured-agent-session-queued-publication'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import type { StructuredAgentSessionCurrentWork } from './structured-agent-session-current-work'

export type AgentSessionSubscriberEmit = (event: AgentSessionSubscribeEvent) => void
export type Subscriber = CurrentRequestsSubscriber &
  SubscriberFieldState &
  ComposerMetadata.AgentSessionComposerMetadata & {
    id: string
    emit: AgentSessionSubscriberEmit
    cursor: AgentJournalCursor
    fence: number
    snapshotCatchUp?: boolean
    /** Last frame’s current-work key; row-free changes still require a frame. */
    workView?: string
    /** Semantic history baseline actually emitted, independent of token/row progress. */
    historyView?: string
  }

export type AgentSessionSubscribersHooks = Pick<
  ComposerMetadata.AgentSessionComposerMetadataHooks,
  'readPromptSuggestion'
> & {
  readCommands?: SubscriberFieldHooks['readCommands']
  /** Stable identity avoids serialization until queue changes. */
  readQueuePublication?: (sessionId: string) => QueuePublication | undefined
  readBackgroundTasks?: SubscriberFieldHooks['readBackgroundTasks']
  onJournalPublished?: (sessionId: string, journal: AgentSessionJournal) => void
  readCurrentWork?: (
    sessionId: string,
    journal: AgentSessionJournal
  ) => StructuredAgentSessionCurrentWork | undefined
  now?: () => number
}
