import * as usageLimit from '../recovery/structured-agent-session-host-background'
import { createStructuredAgentSessionConversationReads } from './structured-agent-session-conversation-reads'
import { continuationContextReader as contextReader } from '../recovery/structured-agent-session-continuation-context'
import { structuredAgentStartJournal } from '../acquisition/structured-agent-start-journal'
import { StructuredConversationCommandController as CommandController } from '../operations/structured-conversation-command-controller'
// Serialize durable mutations per conversation; open at rest and start a child only when work needs it.

import type { AgentSessionSubscribeInput } from '../publication/subscribers/agent-session-subscribe-input'
import { StructuredAgentSessionTaskQueue } from './structured-agent-session-task-queue'
import { structuredAgentSessionEntryDelegates } from '../acquisition/structured-agent-session-entry-delegates'
import * as mutationWiring from './structured-agent-session-host-mutation-wiring'
import { createStructuredAgentSessionTabSurface as createTabs } from './structured-agent-session-host-tabs'
import {
  createStructuredAgentSessionHostCollaborators as createCollaborators,
  createStructuredAgentSessionHostPublication as createPublication
} from './structured-agent-session-host-collaborators'
import * as Collaborators from './structured-agent-session-host-collaborators'
import { createStructuredAgentSessionCredentials as createCredentials } from './structured-agent-session-credentials'
import { flushStructuredAgentSessionHost } from '../termination/structured-agent-session-host-teardown'
import type * as HostTypes from './structured-agent-session-host-types'
import * as sessionLogger from './structured-agent-session-logger'
import { createStructuredAgentSessionWorkspaceSleeper } from '../termination/structured-agent-session-workspace-sleep'

type Parts = Collaborators.StructuredAgentSessionCollaborators

export class StructuredAgentSessionHost {
  private readonly conversationCommands = new CommandController(() => this.mutationContext(), this)
  private core = (): Collaborators.StructuredAgentSessionHostCore => ({
    deps: this.deps,
    sessions: this.sessions,
    queued: this.queued,
    clientDelivery: this.clientDelivery,
    subscribers: this.subscribers,
    tasks: this.tasks,
    serialize: (sessionId, task) => this.serialize(sessionId, task),
    now: () => this.now(),
    runtimeState: this.runtimeState,
    lifetime: this.lifetime,
    conversationDelivery: this.conversationDelivery,
    eventRecovery: this.eventRecovery,
    restartResume: this.restartResume,
    backgroundTasks: this.backgroundTasks,
    startup: this.startup,
    usageLimitContinue: this.usageLimitContinue
  })
  private readonly publication = createPublication(this.core)
  private readonly sessions = this.publication.sessions
  private readonly queued = this.publication.queued
  private readonly clientDelivery = this.publication.clientDelivery
  private readonly subscribers = this.publication.subscribers
  private readonly tasks = new StructuredAgentSessionTaskQueue()
  declare private readonly runtimeState: Parts['runtimeState']
  declare private readonly startup: Parts['startup']
  readonly reconcileRestartLeases = () => this.startup.reconcileRestartLeases()
  declare private readonly lifetime: Parts['lifetime']
  declare private readonly conversationDelivery: Parts['conversationDelivery']
  /** Public for `restartProviderChild`; the host file has no line budget for a forwarder. */
  declare readonly eventRecovery: Parts['eventRecovery']
  declare private readonly backgroundTasks: Parts['backgroundTasks']
  declare readonly restartResume: Parts['restartResume']

  readonly usageLimitContinue: ReturnType<typeof usageLimit.start>

  constructor(readonly deps: HostTypes.StructuredAgentSessionHostDeps) {
    // Collaborators share a logger wrapper that cannot fail the operation it reports.
    this.deps = deps = sessionLogger.withNeverThrowingLogger(deps)
    this.clientDelivery.watchAtRestCommands(deps.adapter)
    Object.assign(this, createCollaborators(this.core, this))
    this.continuationContext = contextReader(deps, this.lifetime.conversation)
    this.usageLimitContinue = usageLimit.start(this.mutationContext(), this, this.clientDelivery)
    this.runtimeState.startLeaseRenewal()
    this.lifetime.idleSweep.start()
  }

  private now = (): number => this.deps.now?.() ?? Date.now()

  hasSession = (sessionId: string): boolean => this.sessions.has(sessionId)
  loadedSessionIds = this.sessions.loadedSessionIds
  hasLoadedProviders = (): boolean => this.loadedSessionIds().length > 0
  private readonly reads = createStructuredAgentSessionConversationReads(() => ({
    ...this.core(),
    readCommands: (id, commandsOnRequest) =>
      this.clientDelivery.readCommandsSettled(id, commandsOnRequest),
    conversation: (id) => this.lifetime.conversation(id)
  }))
  sessionAgent = this.reads.sessionAgent
  attentionReads = this.reads.attentionReads
  readModelCatalog = this.reads.readModelCatalog
  private readonly credentials = createCredentials(this.core)
  childAccountHome = this.credentials.childAccountHome
  prospectiveAccountHome = this.credentials.prospectiveAccountHome

  handleAdapterEvent = (event: Parameters<Parts['eventRecovery']['handle']>[0]) =>
    this.eventRecovery.handle(event)

  private lifetimeContext = () => Collaborators.hostLifetimeContext(this.core())
  private attachContext = () => Collaborators.hostAttachContext(this.core())
  /** Release resources; user-close cancels cut turns, while eviction leaves their failure reportable. */
  close: typeof this.lifetime.close = (...args) => this.lifetime.close(...args)

  restartAgent = this.credentials.restartAgent

  /** Stop hidden children too, using one bounded host snapshot. */
  sleepWorkspace = createStructuredAgentSessionWorkspaceSleeper(this.core)

  serializeCreateIntent = this.tasks.serializeCreateIntent.bind(this.tasks)

  supportsCreate = this.reads.supportsCreate
  agentDefinitions = this.reads.agentDefinitions
  knownAgentIds = this.reads.knownAgentIds

  private readonly tabs = createTabs(this, this.sessions, this.clientDelivery, (ids) =>
    this.startup.recover(ids)
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

  drainStatusWrites = (): Promise<void> => this.clientDelivery.drainStatusWrites()

  revealSession = this.reads.revealSession

  private serialize = this.tasks.serialize.bind(this.tasks)

  private readonly entry = structuredAgentSessionEntryDelegates(() => this.attachContext())
  attach = this.entry.attach
  create = this.entry.create

  /** Test-only barrier for streamed event writes. */
  flushStreamedEvents = (id: string): Promise<void> => this.runtimeState.flushEventSink(id)

  /** Quit stops delivery and queued-card handover. */
  stopDelivery = () => {
    this.sessions.endPublications()
    ;[this.conversationDelivery, this.queued.drain].forEach((d) => d.dispose())
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
  setOption = this.mutations.setOption
  changeThreadGoal = this.mutations.changeThreadGoal
  readOptions = this.mutations.readOptions

  rewind = this.mutations.rewind

  conversationCommand = this.conversationCommands.run
  /** Undefined means unavailable; an empty array is an authoritative catalog. */
  readCommands = this.reads.readCommands

  /** Read the store; idle-released chats have no session-map entry. */
  handoffStatus = (sessionId: string) => this.backgroundTasks.handoffStatus(sessionId)

  history: Parts['backgroundTasks']['history'] = (...args) => this.backgroundTasks.history(...args)

  readonly continuationContext: ReturnType<typeof contextReader>

  observeConversationPublications = this.sessions.observeConversationPublications
  beginConversationTitleWait = (sessionId: string) =>
    this.runtimeState.acquireAborts.begin(sessionId)
  journalSnapshot = (sessionId: string) => this.backgroundTasks.journalSnapshot(sessionId)
  journalCurrentRead = this.reads.journalCurrentRead
  queuedSendAnswer = this.reads.queuedSendAnswer
  /** What became of one send, answered by key, for callers that follow many sends. */
  sendAnswer = this.reads.sendAnswer
  wakeQueuedMessages = (sessionId: string) => this.queued.refresh(sessionId)

  private readonly startJournal = structuredAgentStartJournal(
    () => this.deps,
    (sessionId) => this.lifetime.conversation(sessionId)
  )
  captureAgentStartDestination = this.startJournal.captureAgentStartDestination
  appendAgentStart = this.startJournal.appendAgentStart

  currentWork = this.clientDelivery.readCurrentWork
  readCurrentRequests: Parts['backgroundTasks']['currentRequests'] = (...args) =>
    this.backgroundTasks.currentRequests(...args)

  observeJournalPublications = this.clientDelivery.observeJournalPublications

  subscribe = (input: AgentSessionSubscribeInput) => this.backgroundTasks.subscribe(input)

  settleLateDispatch = this.mutations.settleLateDispatch
  /** Republish row-free changes to held work. */
  publishWorkChanged: (sessionId: string) => void = this.clientDelivery.publishGenerationEnded

  publishChildWorkEvidence = this.clientDelivery.publishChildWork
  unsubscribe = (sessionId: string, id: string): void => this.subscribers.close(sessionId, id)

  /** Retains no per-session subscription. */
  subscribeStatus = this.clientDelivery.subscribeStatus
  publishConversationName = this.clientDelivery.publishConversationName
  regenerateConversationName = (sessionId: string): boolean =>
    this.deps.conversationNaming?.regenerate(sessionId) ?? false
  setUserConversationName: HostTypes.SetUserConversationName = (...args) =>
    this.deps.conversationNaming?.setUserName(...args) ?? Promise.resolve(null)

  /** Live-only completion/prompt events; missed events are never replayed. */
  subscribeTurnCompletions = this.clientDelivery.subscribeTurnCompletions
  readStatusSummary = this.clientDelivery.readStatusSummary

  collaboratorsForTests = () => ({
    sessions: this.sessions,
    subscribers: this.subscribers,
    runtimeState: this.runtimeState,
    conversationDelivery: this.conversationDelivery,
    lifetime: this.lifetime,
    serialize: this.serialize
  })
}
