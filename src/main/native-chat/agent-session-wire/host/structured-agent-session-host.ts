import * as usageLimit from '../recovery/structured-agent-session-host-background'
import { createStructuredAgentSessionConversationReads } from './structured-agent-session-conversation-reads'
import { continuationContextReader as contextReader } from '../recovery/structured-agent-session-continuation-context'
import { structuredAgentStartJournal } from '../acquisition/structured-agent-start-journal'
import { StructuredConversationCommandController as CommandController } from '../operations/structured-conversation-command-controller'

import { StructuredAgentSessionTaskQueue } from './structured-agent-session-task-queue'
import { structuredAgentSessionEntryDelegates } from '../acquisition/structured-agent-session-entry-delegates'
import * as mutationWiring from './structured-agent-session-host-mutation-wiring'
import { createStructuredAgentSessionTabSurface as createTabs } from './structured-agent-session-host-tabs'
import * as Collaborators from './structured-agent-session-host-collaborators'
import { createStructuredAgentSessionCredentials as createCredentials } from './structured-agent-session-credentials'
import { flushStructuredAgentSessionHost } from '../termination/structured-agent-session-host-teardown'
import type * as HostTypes from './structured-agent-session-host-types'
import * as sessionLogger from './structured-agent-session-logger'
import { createStructuredAgentSessionWorkspaceSleeper } from '../termination/structured-agent-session-workspace-sleep'

type Parts = Collaborators.StructuredAgentSessionCollaborators
type Background = Parts['backgroundTasks']

export class StructuredAgentSessionHost {
  private readonly conversationCommands = new CommandController(() => this.mutationContext(), this)
  private core = (): Collaborators.StructuredAgentSessionHostCore => ({
    deps: this.deps,
    ...this.publication,
    tasks: this.tasks,
    serialize: (sessionId, task) => this.serialize(sessionId, task),
    now: () => this.deps.now?.() ?? Date.now(),
    ...this.parts,
    usageLimitContinue: this.usageLimitContinue
  })
  private readonly publication = Collaborators.createStructuredAgentSessionHostPublication(
    this.core
  )
  private readonly sessions = this.publication.sessions
  private readonly queued = this.publication.queued
  private readonly clientDelivery = this.publication.clientDelivery
  private readonly tasks = new StructuredAgentSessionTaskQueue()
  private readonly parts: Parts
  readonly reconcileRestartLeases = () => this.parts.startup.reconcileRestartLeases()
  readonly lifetime: Parts['lifetime']
  readonly eventRecovery: Parts['eventRecovery']
  readonly restartResume: Parts['restartResume']

  readonly usageLimitContinue: ReturnType<typeof usageLimit.start>

  constructor(readonly deps: HostTypes.StructuredAgentSessionHostDeps) {
    // Collaborators share a logger wrapper that cannot fail the operation it reports.
    this.deps = deps = sessionLogger.withNeverThrowingLogger(deps)
    this.clientDelivery.watchAtRestCommands(deps.adapter)
    this.parts = Collaborators.createStructuredAgentSessionHostCollaborators(this.core, this)
    this.lifetime = this.parts.lifetime
    this.eventRecovery = this.parts.eventRecovery
    this.restartResume = this.parts.restartResume
    this.continuationContext = contextReader(deps, this.lifetime.conversation)
    this.usageLimitContinue = usageLimit.start(this.mutationContext(), this, this.clientDelivery)
    this.parts.runtimeState.startLeaseRenewal()
    this.lifetime.idleSweep.start()
  }

  hasSession = (sessionId: string): boolean => this.sessions.has(sessionId)
  loadedSessionIds = this.sessions.loadedSessionIds
  chatSessionCount = (): number =>
    this.parts.runtimeState.startFlights.countWith(this.loadedSessionIds())
  private readonly credentials = createCredentials(this.core, () => this.attachContext())
  readonly reads = createStructuredAgentSessionConversationReads(
    () => ({
      ...this.lifetimeContext(),
      serialize: this.serialize,
      seal: (id) => this.parts.runtimeState.sealEventSink(id),
      readCommands: this.clientDelivery.readCommandsSettled,
      conversation: (sessionId) => this.lifetime.conversation(sessionId)
    }),
    this.credentials
  )
  sessionAgent = this.reads.sessionAgent
  attentionReads = this.reads.attentionReads
  readModelCatalog = this.reads.readModelCatalog
  childAccountHome = this.credentials.childAccountHome
  prospectiveAccountHome = this.credentials.prospectiveAccountHome

  handleAdapterEvent = (e: Parameters<Parts['eventRecovery']['handle']>[0]) =>
    this.eventRecovery.handle(e)

  private lifetimeContext = () => Collaborators.hostLifetimeContext(this.core())
  private attachContext = () => Collaborators.hostAttachContext(this.core())
  /** Release resources; user-close cancels cut turns, while eviction leaves their failure reportable. */
  close: typeof this.lifetime.close = (...args) => this.lifetime.close(...args)

  /** Stop a finished background run's agent now, as the idle sweep would; owed work keeps it, and
   *  so does a viewer unless `anyway`. */
  releaseIdleSession = (id: string, anyway?: boolean) => this.lifetime.idleSweep.release(id, anyway)

  /** Stop hidden children too, using one bounded host snapshot. */
  sleepWorkspace = createStructuredAgentSessionWorkspaceSleeper(this.core)

  serializeCreateIntent = this.tasks.serializeCreateIntent.bind(this.tasks)

  supportsCreate = this.reads.supportsCreate
  knownAgentIds = this.reads.knownAgentIds

  private readonly tabs = createTabs(this, this.sessions, this.clientDelivery, (ids) =>
    this.parts.startup.recover(ids)
  )
  listSessionTabs = this.tabs.listSessionTabs
  isSessionTabVisible = this.tabs.isSessionTabVisible
  getPersistedVisibleSessionTabIndex = this.tabs.getPersistedVisibleSessionTabIndex
  getSessionTabId = this.tabs.getSessionTabId
  showSessionTabs = this.tabs.showSessionTabs
  setSessionTabVisibility = this.tabs.setSessionTabVisibility
  notifySessionTabHidden = this.tabs.notifySessionTabHidden
  /** Includes unreadable chat records. */
  holdsSessions = this.reads.holdsSessions
  onSessionsHeld = this.reads.onSessionsHeld

  seedSessionTabs = this.tabs.seedSessionTabs

  drainStatusWrites = this.clientDelivery.drainStatusWrites

  revealSession = this.reads.revealSession

  /** The chat's conversation lane: opens, attaches and creates hold it, so open-or-absent is exact. */
  serialize = this.tasks.serialize.bind(this.tasks)
  withForkSourceAdmission = this.serialize

  private readonly entry = structuredAgentSessionEntryDelegates(() => this.attachContext())
  attach = this.entry.attach
  create = this.entry.create

  /** Test-only barrier for streamed event writes. */
  flushStreamedEvents = (id: string) => this.parts.runtimeState.flushEventSink(id)

  /** Quit stops delivery and queued-card handover. */
  stopDelivery = () => {
    this.sessions.endPublications()
    ;[this.parts.conversationDelivery, this.queued.drain].forEach((d) => d.dispose())
    this.usageLimitContinue.dispose()
  }

  async flushAllStreamedEvents(options?: { trigger?: 'quit' | 'update' }): Promise<void> {
    this.stopDelivery()
    await flushStructuredAgentSessionHost({
      ...this.lifetimeContext(),
      idleSweep: this.lifetime,
      tasks: this.tasks,
      restartResume: this.restartResume,
      serialize: this.serialize,
      trigger: options?.trigger ?? 'quit'
    }).finally(() => this.clientDelivery.closeAll())
  }

  private mutationContext = () => Collaborators.hostMutationContext(this.core)

  send = this.conversationCommands.send

  queuedMessageSend = this.queued.queuedMessageSend
  queuedMessageDelete = this.queued.queuedMessageDelete
  queuedMessageMove = this.queued.queuedMessageMove
  queuedMessagesResume = this.queued.queuedMessagesResume
  queuedMessageUpdate = this.queued.queuedMessageUpdate
  queuedMessageEditHold = this.queued.queuedMessageEditHold

  waitForSendSettlement = this.clientDelivery.waitForSendSettlement

  mutations = mutationWiring.structuredAgentSessionMutationDelegates(
    () => this.mutationContext(),
    () => this.attachContext(),
    this.credentials.restartAgentForCredentials
  )
  cancel = this.mutations.cancel
  respondToPrompt = this.mutations.respondToPrompt
  approveAutoReviewDenial = this.mutations.approveAutoReviewDenial
  setOption = this.mutations.setOption
  changeThreadGoal = this.mutations.changeThreadGoal
  readOptions = this.mutations.readOptions

  rewind = this.mutations.rewind

  conversationCommand = this.conversationCommands.run
  readCommands = this.reads.readCommands

  handoffStatus = (sessionId: string) => this.parts.backgroundTasks.handoffStatus(sessionId)

  history: Background['history'] = (...args) => this.parts.backgroundTasks.history(...args)

  readonly continuationContext: ReturnType<typeof contextReader>

  /** Opens the conversation at rest, starting no agent; Orca's own notes write through it. */
  conversation = (sessionId: string) => this.lifetime.conversation(sessionId)
  observeConversationPublications = this.sessions.observeConversationPublications
  forkBoundary: Background['forkBoundary'] = (...a) => this.parts.backgroundTasks.forkBoundary(...a)
  savedContent = (sessionId: string) => this.parts.backgroundTasks.savedContent(sessionId)
  /** A conversation's bounded journal reads, opened at rest. */
  journalReads = async (id: string) => (await this.conversation(id)).journal.reads
  historyItem = (id: string, itemId: string) => this.parts.backgroundTasks.historyItem(id, itemId)
  conversationOutline = (sessionId: string) =>
    this.parts.backgroundTasks.conversationOutline(sessionId)
  namingPrompt = this.reads.namingPrompt
  approvalPrompt = this.reads.approvalPrompt
  automationRun = this.reads.automationRun
  queuedSendAnswer = this.reads.queuedSendAnswer
  sendAnswer = this.reads.sendAnswer
  mailObservation = this.reads.mailObservation
  holdMailSources = this.reads.holdMailSources
  wakeQueuedMessages = (sessionId: string) => this.queued.refresh(sessionId)

  private readonly startJournal = structuredAgentStartJournal(() => this.deps, this.conversation)
  captureAgentStartDestination = this.startJournal.captureAgentStartDestination
  appendAgentStart = this.startJournal.appendAgentStart

  currentWork = this.clientDelivery.readCurrentWork
  currentWorkAtRest = this.reads.currentWorkAtRest
  readCurrentRequests: Background['currentRequests'] = (req) =>
    this.parts.backgroundTasks.currentRequests(req)

  observeJournalPublications = this.clientDelivery.observeJournalPublications

  subscribe: Background['subscribe'] = (input) => this.parts.backgroundTasks.subscribe(input)

  settleLateDispatch = this.mutations.settleLateDispatch
  publishWorkChanged: (sessionId: string) => void = this.clientDelivery.publishGenerationEnded
  publishBackgroundTasks = (sessionId: string): void =>
    this.parts.backgroundTasks.publish(sessionId)

  publishChildWorkEvidence = this.clientDelivery.publishChildWork
  unsubscribe = (id: string, key: string): void => this.clientDelivery.subscribers.close(id, key)

  subscribeStatus = this.clientDelivery.subscribeStatus
  publishConversationName = this.clientDelivery.publishConversationName
  regenerateConversationName = this.reads.regenerateConversationName
  setUserConversationName = this.reads.setUserConversationName
  skipAsyncQuestions = this.reads.skipAsyncQuestions

  subscribeTurnCompletions = this.clientDelivery.subscribeTurnCompletions
  readStatusSummary = this.clientDelivery.readStatusSummary
  /** The usage-limit continue as the journal stands now, ahead of the next status publish. */
  readUsageLimitContinue = async (id: string) =>
    this.usageLimitContinue.readState(id, await this.clientDelivery.readUsageLimitCut(id))
  publishedWork = this.clientDelivery.readPublishedWork

  collaboratorsForTests = () => ({
    deps: this.deps,
    tasks: this.tasks,
    lifetime: this.lifetime,
    sessions: this.sessions,
    subscribers: this.clientDelivery.subscribers,
    runtimeState: this.parts.runtimeState,
    conversationDelivery: this.parts.conversationDelivery,
    clientDelivery: this.clientDelivery,
    serialize: this.serialize
  })
}
