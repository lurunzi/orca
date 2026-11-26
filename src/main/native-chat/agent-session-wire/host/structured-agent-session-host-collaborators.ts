import * as usageLimit from '../recovery/structured-agent-session-host-background'
import { createStartupRecovery } from '../recovery/structured-agent-session-restart-reconcile'
import { StructuredAgentSessionHostRuntimeState } from './structured-agent-session-host-runtime-state'
import type { StructuredAgentSessionTaskQueue } from './structured-agent-session-task-queue'
import type { StructuredAgentSessionLifetimeContext } from '../termination/structured-agent-session-host-lifetime'
import * as agentStart from '../startup/structured-agent-session-agent-start'
import { createRestartableStructuredAgentSessionConversationLifetime } from './structured-agent-session-credentials'
import type { StructuredAgentSessionAttachContext } from '../acquisition/structured-agent-session-attach-context'
import type * as HostTypes from './structured-agent-session-host-types'
import * as mutationWiring from './structured-agent-session-host-mutation-wiring'
import { StructuredAgentSessionEventRecovery } from '../termination/structured-agent-session-event-recovery'
import { StructuredAgentSessionBackgroundTaskChannel as BackgroundTasks } from '../publication/subscribers/structured-agent-session-background-task-channel'
import { StructuredAgentSessionClientDelivery } from '../publication/subscribers/structured-agent-session-client-delivery'
import { createStructuredAgentSessionPublicationWiring } from './structured-agent-session-publication-wiring'
import { wireStructuredAgentSessionQueuedMessages as wireQueuedMessages } from '../delivery/structured-agent-session-queued-wiring'
import * as resume from '../recovery/structured-agent-session-restart-resume-host'
import type { StructuredAgentSessionRestartResume } from '../recovery/structured-agent-session-restart-resume-contract'
import { structuredAgentSessionRestartResumeSurfaces } from '../recovery/structured-agent-session-restart-resume-wiring'
import * as conversation from '../delivery/structured-agent-session-host-delivery'

export type StructuredAgentSessionCollaborators = {
  backgroundTasks: BackgroundTasks
  runtimeState: StructuredAgentSessionHostRuntimeState
  conversationDelivery: conversation.StructuredAgentSessionConversationDelivery
  startup: ReturnType<typeof createStartupRecovery>
  eventRecovery: StructuredAgentSessionEventRecovery
  restartResume: StructuredAgentSessionRestartResume
  lifetime: HostTypes.StructuredAgentSessionConversationLifetime
}

export type StructuredAgentSessionPublication = ReturnType<
  typeof createStructuredAgentSessionHostPublication
>

/** Current host fields; read through a getter so moved maps and late collaborators are never stale. */
export type StructuredAgentSessionHostCore = StructuredAgentSessionCollaborators &
  StructuredAgentSessionPublication & {
    deps: HostTypes.StructuredAgentSessionHostDeps
    tasks: StructuredAgentSessionTaskQueue
    serialize: StructuredAgentSessionTaskQueue['serialize']
    now: () => number
    usageLimitContinue: ReturnType<typeof usageLimit.start>
  }

type Core = () => StructuredAgentSessionHostCore

// Keep inference so publishStatus stays required in the attach-context spread.
export function hostLifetimeContext(core: StructuredAgentSessionHostCore) {
  return {
    deps: core.deps,
    runtimeState: core.runtimeState,
    sessions: core.sessions,
    now: core.now,
    publishStatus: core.clientDelivery.publishStatus,
    generationEnded: core.clientDelivery.publishGenerationEnded,
    wakeDelivery: (sessionId: string) => core.conversationDelivery.loop.wake(sessionId),
    endExitedChild: core.eventRecovery.endExitedChildUnderSerialize
  } satisfies StructuredAgentSessionLifetimeContext
}

export function hostAttachContext(
  core: StructuredAgentSessionHostCore
): StructuredAgentSessionAttachContext {
  return {
    ...hostLifetimeContext(core),
    subscribers: core.subscribers,
    tasks: core.tasks,
    reconcileLeases: (sessionId) => core.runtimeState.reconcileLeases(sessionId),
    serialize: core.serialize,
    openProviderChild: core.eventRecovery.openProviderChild,
    openConversation: core.conversationDelivery.open
  }
}

export function hostMutationContext(core: Core) {
  const current = core()
  return mutationWiring.createStructuredAgentSessionHostMutationContext({
    deps: current.deps,
    sessions: current.sessions,
    lifetime: current.lifetime,
    clientDelivery: current.clientDelivery,
    conversationDelivery: current.conversationDelivery,
    queued: current.queued,
    runtimeState: current.runtimeState,
    attachContext: () => hostAttachContext(core()),
    trackProviderOperation: (operation) => current.tasks.trackAttach(operation),
    serialize: current.serialize,
    now: current.now
  })
}

/** Publication, queued cards and client delivery exist before the constructor runs. */
export function createStructuredAgentSessionHostPublication(core: Core) {
  const sessions = createStructuredAgentSessionPublicationWiring({
    client: () => clientDelivery,
    delivery: () => core().conversationDelivery,
    opened: (id) => usageLimit.opened(core().usageLimitContinue, queued, id),
    workChanged: (id) => core().runtimeState.refreshActivity(id),
    logger: () => core().deps.logger,
    now: () => core().now(),
    observeRows: () => core().deps.observeCommittedRows
  })
  const queued = wireQueuedMessages(sessions, () => hostMutationContext(core))
  // Journal publication renews idle activity.
  const clientDelivery = new StructuredAgentSessionClientDelivery(
    sessions,
    () => core().now(),
    () => core().deps,
    queued,
    (sessionId) => core().restartResume.onAgentStarted(sessionId),
    (sessionId) => core().backgroundTasks.publish(sessionId),
    (sessionId) => core().backgroundTasks.read(sessionId),
    (sessionId) => core().runtimeState?.startFlights.projectsStarting(sessionId) ?? false,
    sessions,
    (sessionId, cut) => core().usageLimitContinue?.readState(sessionId, cut),
    (sessionId) => core().runtimeState?.currentEventSink(sessionId)?.liveText() ?? []
  )
  return { sessions, queued, clientDelivery, subscribers: clientDelivery.subscribers }
}

/** Assemble dependencies before lease renewal and the idle sweep begin. */
export function createStructuredAgentSessionHostCollaborators(
  core: Core,
  host: Parameters<typeof structuredAgentSessionRestartResumeSurfaces>[0]
): StructuredAgentSessionCollaborators {
  const { deps, sessions, clientDelivery, tasks, serialize, now } = core()
  // Start and exit callbacks run once the runtime has a child.
  let lifetime!: HostTypes.StructuredAgentSessionConversationLifetime
  let eventRecovery!: StructuredAgentSessionEventRecovery
  let conversationDelivery: conversation.StructuredAgentSessionConversationDelivery
  const backgroundTasks = new BackgroundTasks(
    deps,
    sessions,
    core().subscribers,
    (sessionId) => lifetime.conversation(sessionId),
    clientDelivery.readCurrentWork,
    clientDelivery.readChildWork,
    clientDelivery.childWorkIncomplete
  )
  const runtimeState = new StructuredAgentSessionHostRuntimeState(
    deps,
    sessions,
    (id, e) => eventRecovery.recoverAfterSinkFailure(id, e),
    (expired) => lifetime.expireStartup(expired),
    (id) => conversationDelivery?.loop.isRunning(id) ?? false,
    clientDelivery
  )
  conversationDelivery = conversation.createStructuredAgentSessionConversationDelivery({
    deps,
    acquireAborts: runtimeState.acquireAborts,
    sessions,
    serialize: (sessionId, task) => serialize(sessionId, task),
    // Quit drains tracked starts before eviction so their children are stopped.
    trackStart: (start) => tasks.trackAttach(start),
    startProviderChild: (sessionId, startedFor) =>
      agentStart.claimStructuredAgentSessionAgent(hostAttachContext(core()), sessionId, startedFor),
    deliveryOrder: runtimeState.deliveryOrder,
    startFlights: runtimeState.startFlights,
    readiness: (id, child) => runtimeState.startupAttempts.readiness(id, child),
    // Retire at rest; the next start refreshes login and permission mode.
    stopOutgrownAgent: (id) => lifetime.stopAgent(id, { cause: 'evict', resting: true }),
    stopPermissionTransitionChild: (id) => lifetime.stopAgent(id, { cause: 'evict' }),
    clientDelivery
  })
  const startup = createStartupRecovery(deps, runtimeState.reconcileLeases, runtimeState)
  eventRecovery = new StructuredAgentSessionEventRecovery({
    deps,
    store: deps.store,
    sessions,
    flushLifecycle: (sessionId) => runtimeState.lifecycleBarrier(sessionId),
    publishStatus: clientDelivery.publishStatusAndSettlement,
    generationEnded: clientDelivery.publishGenerationEnded,
    serialize: (sessionId, task) => tasks.trackAttach(serialize(sessionId, task)),
    now,
    runtimeState,
    wakeDelivery: (sessionId) => conversationDelivery.loop.wake(sessionId),
    failStartingChild: (...args) => lifetime.failStartingChild(...args),
    trackOpen: (open) => tasks.trackAttach(open)
  })
  const restartResume = resume.createStructuredAgentSessionRestartResume(deps, sessions, {
    ...structuredAgentSessionRestartResumeSurfaces(host, now),
    readChildWork: clientDelivery.readChildWork,
    childWorkOpen: clientDelivery.childWorkOpen,
    publishStatus: clientDelivery.publishStatusAndSettlement
  })
  lifetime = createRestartableStructuredAgentSessionConversationLifetime({
    context: () =>
      hostLifetimeContext({ ...core(), runtimeState, conversationDelivery, eventRecovery }),
    sessions,
    serialize: (sessionId, task) => serialize(sessionId, task),
    open: (sessionId) => conversationDelivery.open(sessionId),
    // In-flight starts count as execution before a child is indexed.
    deliveryActive: (id) => runtimeState.hasDeliveryWork(id),
    closeStatus: (sessionId, options) => clientDelivery.closeSession(sessionId, options),
    childWorkOpen: clientDelivery.childWorkOpen,
    viewed: (id) => clientDelivery.subscribers.subscriberCount(id) > 0
  })
  return {
    backgroundTasks,
    runtimeState,
    conversationDelivery,
    startup,
    eventRecovery,
    restartResume,
    lifetime
  }
}
