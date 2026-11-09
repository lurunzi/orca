import { readCodexDashboardAdoptions } from '../../codex-structured-session-process-state'
import { copyCodexConversation } from '../../codex-conversation-copy'
import { readCodexSessionAccountUsage } from './codex-session-account-usage'
import * as permission from '../turns/codex-structured-turn-permission'
import * as Suggestion from '../../codex-prompt-suggestion-session'
import { projectCodexSessionOptions } from '../catalog/codex-structured-service-tier'
import type { AgentSessionBackgroundTaskState } from '../../../../shared/agent-session/agent-session-background-task-wire'
import type {
  AgentSessionAcquisition,
  AgentSessionDispatchOutcome,
  StructuredAgentSessionAcquireInput,
  StructuredAgentSessionAdapter as SessionAdapter,
  StructuredAgentSessionSetOptionInput
} from '../../../native-chat/agent-session-wire/providers/structured-agent-session-adapter'
import type { StructuredAgentSessionProviderOpenInput } from '../../../native-chat/agent-session-wire/startup/structured-agent-session-provider-open-contract'
import type { CodexJournalTranslationAdmission } from '../journal/codex-structured-journal-contracts'
import { dispatchCodexTurn } from '../turns/codex-structured-turn-start'
import { isCodexTurnOptionKey } from '../turns/codex-turn-option-keys'
import { isNativeLocalLocation as supportsCodexStructuredLocation } from '../../../../shared/execution-host'
import { CodexStructuredSessionTeardown } from './codex-structured-session-teardown'
import {
  applyCodexStructuredSessionOption,
  readLiveCodexSessionOptions
} from '../catalog/codex-structured-session-options'
import {
  prepareCodexMessageDispatch,
  readCodexAppliedInputOptions
} from '../turns/codex-structured-message-options'
import {
  CodexAcquisitionRegistry,
  requireLiveCodexSession,
  type CodexSession,
  type CodexStructuredSessionAdapterDeps,
  type CodexStructuredSessionEvent
} from './codex-structured-session-state'
import {
  deliverCodexServerRequest,
  deliverCodexUnhandledFrame,
  translateCodexNotification
} from './codex-structured-provider-events'
import { createCodexStructuredNotificationRetry } from './codex-structured-notification-retry'
import { acquireCodexStructuredSession } from '../acquisition/codex-structured-session-acquire'
import { deliverCodexAcquisitionEvent } from '../acquisition/codex-structured-acquisition-window'
import * as requestEndWait from '../turns/codex-request-end-wait'
import { changeCodexThreadGoalWithSettings } from '../threads/codex-structured-thread-goal'
import { startCodexTerminalStopProbe } from '../background-work/codex-background-terminals'
import * as backgroundStops from '../background-work/codex-background-task-stops'
import {
  compactCodexStructuredSession,
  answerCodexStructuredPrompt,
  cancelCodexStructuredTurn
} from '../prompts/codex-structured-prompt-ownership'
import { renameCodexProviderSession } from './codex-provider-session-rename'
import { DashboardCodexRefreshMailbox } from '../../../dashboard-accounts/dashboard-codex-refresh-mailbox'
import * as codexRewind from '../threads/codex-structured-rewind'
import * as turnEnd from '../turns/codex-structured-turn-end-settlement'
import { codexAcquireFailure } from '../../app-server/codex-startup-outcome'
import { openCodexStart, recoverCodexRewindAtStart } from './codex-structured-start-verdict'
import { codexLiveProviderProcessHold } from './codex-structured-live-provider-process'
import { CodexShortLivedOperations } from './codex-short-lived-operations'

export class CodexStructuredSessionAdapter implements SessionAdapter {
  private readonly sessions = new Map<string, CodexSession>()
  private readonly acquisitions = new CodexAcquisitionRegistry()
  private readonly mailbox = new DashboardCodexRefreshMailbox()
  private readonly shortLived: CodexShortLivedOperations
  private readonly notificationRetries: ReturnType<typeof createCodexStructuredNotificationRetry>
  private readonly teardown: CodexStructuredSessionTeardown

  constructor(private readonly deps: CodexStructuredSessionAdapterDeps) {
    this.atRestCommands = deps.atRestCommands
    this.shortLived = new CodexShortLivedOperations({ mailbox: this.mailbox, ...deps })
    const invocation = () => deps.providerInvocation
    this.readAccountUsage = readCodexSessionAccountUsage(this.sessions, invocation, this.shortLived)
    this.notificationRetries = createCodexStructuredNotificationRetry({
      sessionFor: (sessionId) => this.sessions.get(sessionId),
      translate: (sessionId, session, method, params, observedAt, dispatchSequenceAtReceipt) =>
        translateCodexNotification({
          sessionId,
          session,
          method,
          params,
          observedAt,
          dispatchSequenceAtReceipt,
          emit: (current, event) => this.emit(current, event)
        })
    })
    this.teardown = new CodexStructuredSessionTeardown({
      sessions: this.sessions,
      acquisitions: this.acquisitions,
      ...(deps.onEvent ? { onEvent: deps.onEvent } : {}),
      ...(deps.logger ? { logger: deps.logger } : {}),
      forgetNotificationRetries: (sessionId) => this.notificationRetries.clear(sessionId, null)
    })
  }

  copyConversation: NonNullable<SessionAdapter['copyConversation']> = (input) =>
    copyCodexConversation(input, this.deps.providerInvocation)
  readAccountUsage: NonNullable<SessionAdapter['readAccountUsage']>

  supportsLocation = supportsCodexStructuredLocation

  readDashboardCodexRefreshes = () => this.mailbox.read()

  readDashboardCodexProcesses = () =>
    readCodexDashboardAdoptions(this.sessions, this.acquisitions.size)

  readCommands: NonNullable<SessionAdapter['readCommands']> = (sessionId) =>
    this.sessions.get(sessionId)?.skillReport?.read()

  readonly atRestCommands: CodexStructuredSessionAdapterDeps['atRestCommands']

  renameProviderSession: NonNullable<SessionAdapter['renameProviderSession']> = (input) =>
    renameCodexProviderSession({
      ...input,
      session: this.sessions.get(input.record.sessionId),
      invocation: this.deps.providerInvocation,
      owner: this.shortLived
    })

  permissionModeRequiresAcquisition = permission.codexNativeResumeRequirement(this.sessions)

  settlePermissionTransition = permission.createCodexPermissionTransition(this.sessions, this)

  acquire = (input: StructuredAgentSessionAcquireInput): Promise<AgentSessionAcquisition> =>
    acquireCodexStructuredSession({
      input,
      deps: this.deps,
      sessions: this.sessions,
      acquisitions: this.acquisitions,
      mailbox: this.mailbox,
      notificationRetries: this.notificationRetries,
      deliver: (acquisition, sessionId, event, retainedBytes) =>
        deliverCodexAcquisitionEvent(this.sessions, acquisition, sessionId, event, retainedBytes),
      handleServerRequest: (sessionId, request) => this.handleServerRequest(sessionId, request),
      handleUnhandledFrame: (sessionId, kind, payload) =>
        this.handleUnhandledFrame(sessionId, kind, payload),
      forceCloseUnexpected: (sessionId, fence, acquisitionGeneration, reason) =>
        this.teardown.forceCloseUnexpected(sessionId, fence, acquisitionGeneration, reason)
    }).catch((error: unknown) => {
      throw codexAcquireFailure(error)
    })

  open = (input: StructuredAgentSessionProviderOpenInput) =>
    openCodexStart(this.acquisitions, input)

  /** Journal first so observers never see an event ahead of its durable row. */
  private emit(
    session: CodexSession,
    event: CodexStructuredSessionEvent
  ): CodexJournalTranslationAdmission {
    if (event.type === 'notification') {
      turnEnd.noteCodexTurnOpened(session, event.method, event.params)
      if (event.method === 'skills/changed') {
        session.skillReport?.refresh(true)
      }
    }
    const admission = session.translator?.handle(event) ?? { accepted: true }
    if (!admission.accepted) {
      return admission
    }
    if (event.type === 'notification') {
      // Only an admitted turn end settles; a refused one settles on the retry that lands.
      turnEnd.settleCodexSendsInEndedTurn(session, event)
      // Child records observe refused frames only after a retry reaches the journal.
      session.backgroundTasks.observe(event, session.prompts.takeAbandonedCommands())
      // After the journal and the parent's republished row, never ahead of either.
      session.backgroundTasks.publishChildWork()
      startCodexTerminalStopProbe(this.sessions, event.sessionId, session, this.deps)
    }
    session.promptSuggestion?.observe(event)
    requestEndWait.settleCodexRequestEndWaiters(session)
    this.deps.onEvent?.(event)
    return admission
  }

  private handleServerRequest(
    sessionId: string,
    request: Parameters<typeof deliverCodexServerRequest>[2]
  ): void {
    if (this.sessions.get(sessionId)?.promptSuggestion?.denyRequest(request)) {
      return
    }
    deliverCodexServerRequest(sessionId, this.sessions.get(sessionId), request, (session, event) =>
      this.emit(session, event)
    )
  }

  private handleUnhandledFrame(sessionId: string, kind: string, params: unknown): void {
    deliverCodexUnhandledFrame(
      sessionId,
      this.sessions.get(sessionId),
      kind,
      params,
      (session, event) => this.emit(session, event)
    )
  }

  /** Test-only compatibility roster; host decisions use durable child records. */
  backgroundTaskState = (sessionId: string): AgentSessionBackgroundTaskState | null | undefined =>
    this.sessions.get(sessionId)?.backgroundTasks.state

  readPromptSuggestion = (id: string) => Suggestion.readCodexPromptSuggestion(this.sessions, id)
  heldSends = (sessionId: string): ReadonlySet<string> | undefined =>
    this.sessions.get(sessionId)?.dispatchEchoes.heldSends()

  holdsLiveProviderProcess = codexLiveProviderProcessHold(this.sessions, this.acquisitions)

  backgroundTaskStops: NonNullable<SessionAdapter['backgroundTaskStops']> = (sessionId) =>
    backgroundStops.codexBackgroundTaskStops(this.sessions.get(sessionId))

  stopBackgroundTasks: NonNullable<SessionAdapter['stopBackgroundTasks']> = (input) =>
    backgroundStops.stopCodexBackgroundTasks(this.sessions, input, this.deps.requestTimeoutMs)

  bindPromptItemId = (
    sessionId: string,
    journalItemId: string,
    promptKey: string,
    turnId?: string | null,
    threadId?: string
  ): void =>
    this.sessions
      .get(sessionId)
      ?.prompts.bindJournalItemId(
        journalItemId,
        threadId ?? this.session(sessionId).threadId,
        promptKey,
        turnId
      )

  async dispatch(
    input: Parameters<SessionAdapter['dispatch']>[0]
  ): Promise<AgentSessionDispatchOutcome> {
    const session = this.fresh(input.sessionId)
    session.dispatchPending = true
    try {
      const outcome = await dispatchCodexTurn(
        session,
        await prepareCodexMessageDispatch(
          session,
          input,
          () => this.sessions.get(input.sessionId) === session
        ),
        this.deps.requestTimeoutMs
      )
      this.deps.onEvent?.({
        type: 'options-reported',
        sessionId: input.sessionId,
        fence: session.fence,
        acquisitionGeneration: session.acquisitionGeneration,
        reportedOptions: {
          model: '',
          reportedPermissionMode: session.reportedOptions.reportedPermissionMode
        }
      })
      return outcome
    } finally {
      session.dispatchPending = false
      requestEndWait.settleCodexRequestEndWaiters(session)
    }
  }

  cancelTurn: SessionAdapter['cancelTurn'] = (request) =>
    cancelCodexStructuredTurn({
      request: Suggestion.cancelDroppingCodexPromptSuggestion(this.sessions, request),
      sessions: this.sessions,
      requestTimeoutMs: this.deps.requestTimeoutMs
    })

  awaitStoppedRequestEnd = requestEndWait.codexStoppedRequestEndWait(this.sessions)

  rewindSupport: NonNullable<SessionAdapter['rewindSupport']> = (sessionId) =>
    this.sessions.get(sessionId)?.historyMode === 'legacy'
      ? { supported: false, reason: 'history-not-paginated' }
      : { supported: true }

  rewind: NonNullable<SessionAdapter['rewind']> = (input) =>
    codexRewind.rewindCodexSession(this.fresh(input.sessionId), input, this.deps.requestTimeoutMs)

  recoverRewind: NonNullable<SessionAdapter['recoverRewind']> = (input) =>
    recoverCodexRewindAtStart(
      this.sessions,
      Suggestion.cancelDroppingCodexPromptSuggestion(this.sessions, input),
      this.deps.requestTimeoutMs
    )

  private fresh = (id: string) => Suggestion.dropCodexPromptSuggestion(this.session(id))

  startupEnding = (id: string, generation: string) => this.acquisitions.endings.get(id, generation)
  retireStartup = (sessionId: string, generation: string) =>
    this.acquisitions.endings.retire(sessionId, generation)

  compact: NonNullable<SessionAdapter['compact']> = (input) =>
    compactCodexStructuredSession(this.fresh(input.sessionId), input, this.deps.requestTimeoutMs)

  changeThreadGoal: NonNullable<SessionAdapter['changeThreadGoal']> = (input) => {
    const session = this.session(input.sessionId)
    return changeCodexThreadGoalWithSettings(
      session,
      input,
      this.deps.requestTimeoutMs,
      () => this.sessions.get(input.sessionId) === session
    )
  }

  answerPrompt: SessionAdapter['answerPrompt'] = (request) =>
    answerCodexStructuredPrompt({ request, sessions: this.sessions })

  async setOption(
    input: StructuredAgentSessionSetOptionInput
  ): Promise<Readonly<Record<string, string>>> {
    // Legacy fastMode maps to a service tier before dispatch.
    if (!isCodexTurnOptionKey(input.key) && input.key !== 'fastMode') {
      throw new Error(`codex app-server has no thread option named ${input.key}`)
    }
    return applyCodexStructuredSessionOption(this.session(input.sessionId), input.key, input.value)
  }

  readOptions = (input: { sessionId: string; fence: number }) =>
    readLiveCodexSessionOptions(this.session(input.sessionId), this.deps.requestTimeoutMs)

  readAppliedInputOptions: NonNullable<SessionAdapter['readAppliedInputOptions']> = (input) =>
    readCodexAppliedInputOptions(this.sessions.get(input.sessionId), input)

  projectOptions = (sessionId: string, options: Readonly<Record<string, string>>) =>
    projectCodexSessionOptions(this.sessions.get(sessionId), options)

  closeSession: NonNullable<SessionAdapter['closeSession']> = (...args) =>
    this.teardown.close(...args)
  forceCloseSession = (sessionId: string): Promise<boolean> => this.teardown.forceClose(sessionId)
  disposeSession: NonNullable<SessionAdapter['disposeSession']> = this.closeSession
  closeAll = (): Promise<void> => this.teardown.closeAll(this.shortLived)
  releaseAcquisition = (input: { sessionId: string }): Promise<boolean> =>
    this.teardown.close(input.sessionId)
  hasOwnedAcquisition = (sessionId: string): boolean =>
    this.acquisitions.get(sessionId) !== undefined || this.sessions.has(sessionId)

  private session(sessionId: string): CodexSession {
    return requireLiveCodexSession(this.sessions, sessionId)
  }
}
