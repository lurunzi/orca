import { useNativeChatComposerEditSession } from '../queue/editing/use-native-chat-composer-edit-session'
import { useNativeChatComposerNotice } from './controls/use-native-chat-composer-notice'
import { useNativeChatComposerPromptSuggestion } from '../use-native-chat-composer-prompt-suggestion'
import { coordinatorTargetFor } from '../NativeChatCoordinatorToggle'
import { useNativeChatMobileHoldNotice } from '../host-access/use-native-chat-mobile-hold-notice'
import { forwardRef, useCallback, useState, useRef } from 'react'
import { useNativeChatComposerInterrupt } from './submit/use-native-chat-composer-interrupt'
import { useNativeChatContextUsageSummary } from '../usage/use-native-chat-context-usage-summary'
import { useNativeChatDraft } from '../drafts/use-native-chat-draft'
import { useNativeChatDraftEvents } from './editor/use-native-chat-draft-events'
import { useNativeChatComposerRecall } from '../drafts/use-native-chat-composer-recall'
import { useNativeChatLaunchDraftAdoption } from '../drafts/use-native-chat-launch-draft-adoption'
import { useNativeChatComposerMentions } from '../native-chat-composer-room'
import { useNativeChatRoomSend } from '../native-chat-room-send'
import { NativeChatComposerRoomProvider } from '../NativeChatComposerRoomProvider'
import { NativeChatComposerWorkspace } from './controls/NativeChatComposerWorkspace'
import { NativeChatComposerField } from './editor/NativeChatComposerField'
import { useNativeChatComposerAttachments } from '../attachments/chips/use-native-chat-composer-attachments'
import { nativeChatComposerSendState } from './submit/native-chat-composer-send-state'
import { useNativeChatSteerChordPreview } from './controls/use-native-chat-steer-chord-preview'
import { useNativeChatComposerPasteAndDrops } from '../use-native-chat-composer-paste-and-drops'
import { useNativeChatComposerKeyDown } from './editor/use-native-chat-composer-keydown'
import { useNativeChatSendLifecycle } from '../session/terminal/send/use-native-chat-send-lifecycle'
import { useNativeChatComposerSessionOptions } from './controls/use-native-chat-composer-session-options'
import {
  useNativeChatDictation,
  nativeChatDictationFieldProps
} from './editor/use-native-chat-dictation'
import { useNativeChatPtyComposerSend } from './submit/use-native-chat-pty-composer-send'
import { useNativeChatStructuredComposerSend } from './submit/use-native-chat-structured-composer-send'
import { useImeEnterGestureOwnership } from '@/lib/text-input/ime/ime-composition-keyboard-event'
import { useNativeChatComposerAppMenuSelection } from './focus/use-native-chat-composer-app-menu-selection'
import { useNativeChatComposerSubmit } from './submit/use-native-chat-composer-submit'
import { useNativeChatComposerCommandPicker } from './pickers/use-native-chat-composer-command-picker'
import type * as C from './native-chat-composer-types'

type ComposerHandle = C.NativeChatComposerHandle

/** Send through the chat’s structured transport or verified PTY route, with agent-aware autocomplete and image handling. */
export const NativeChatComposerPane = forwardRef<ComposerHandle, C.NativeChatComposerProps>(
  function NativeChatComposerPane(
    {
      terminalTabId,
      room,
      editSession,
      paneKey,
      draftScopeKey = paneKey,
      targetPtyId,
      agent,
      canSend = true,
      unavailableHint,
      isWorking = false,
      isStopping = false,
      afterStop,
      onStop,
      onStopBackgroundTasks,
      escapeStops = true,
      onOptimisticSend,
      optimisticSendOutcome,
      onOptimisticSendCanceled,
      onSlashCommand,
      onSubmitted,
      answerCommandLocally,
      onSwitchToTerminal,
      readTerminalScreen,
      readTerminalPromptSuggestion,
      launchSeed,
      structuredTransport,
      steerHead,
      recallSource,
      inputOwnedByCard = false,
      notices: chatNotices,
      workspacePending: pending = false,
      launchPrompt
    },
    ref
  ): React.JSX.Element {
    // Own drafts and attachments by pane/conversation so reconnect PTY replacement and UI mode changes cannot discard unsent input.
    const imeEnterGesture = useImeEnterGestureOwnership()
    const draftState = useNativeChatDraft(draftScopeKey, imeEnterGesture.isComposing)
    const { draft, setDraft, flushDraftAppends } = draftState
    const [caret, setCaret] = useState(draft.length)
    useNativeChatLaunchDraftAdoption({
      terminalTabId,
      agent,
      launchSeed,
      draft,
      setDraft,
      setCaret
    })
    const [activeSuggestion, setActiveSuggestion] = useState(0)
    const holdNotice = useNativeChatMobileHoldNotice(
      structuredTransport ? null : targetPtyId,
      canSend
    )
    const { notices, setNotice } = useNativeChatComposerNotice(chatNotices, holdNotice)
    const { textareaRef } = useNativeChatComposerAppMenuSelection(imeEnterGesture.isComposing)
    const recall = useNativeChatComposerRecall({
      draft,
      source: recallSource,
      inputRef: textareaRef
    })
    const { cancelPendingSends, trackPendingSend } = useNativeChatSendLifecycle(
      terminalTabId,
      targetPtyId,
      onOptimisticSendCanceled,
      { inputOwnedByCard, onPendingSendRetired: optimisticSendOutcome?.reject }
    )

    // Why inputOwnedByCard: the hidden field can still hold keyboard focus for a frame.
    const [hasPty, disabled] = structuredTransport
      ? [true, !canSend || unavailableHint !== undefined]
      : [targetPtyId !== null, targetPtyId === null || !canSend || inputOwnedByCard]
    const attachDisabled =
      disabled ||
      (structuredTransport?.runtime === 'remote' && structuredTransport.sessionPending === true)

    const { picker, orcaCommands, sideChat } = useNativeChatComposerCommandPicker({
      mode: editSession ? 'edit' : launchPrompt || pending ? 'launch' : undefined,
      agent,
      terminalTabId,
      draftScopeKey: paneKey,
      draft,
      caret,
      recalledFromHistory: recall.active,
      disabled,
      isComposing: imeEnterGesture.isComposing,
      room,
      structuredTransport,
      editor: { textareaRef, setDraft, setCaret, setActiveSuggestion },
      setNotice
    })
    const { classifySend, clearSkillOrigin, completeItem, dismiss, handleDraftOrCaretChange } =
      picker
    const mentions = useNativeChatComposerMentions(room, draft, picker, {
      terminalTabId,
      structuredWorktreeId: structuredTransport?.worktreeId,
      caret,
      notices
    })
    const { autocomplete } = mentions

    const resolveTarget = useCallback(
      () => (targetPtyId ? { ptyId: targetPtyId } : null),
      [targetPtyId]
    )

    const attachments = useNativeChatComposerAttachments({
      attachmentScopeKey: draftScopeKey,
      allowWithoutTarget: Boolean(structuredTransport),
      acceptsImages: structuredTransport?.acceptsImages !== false,
      imageReferences: Boolean(structuredTransport),
      caret,
      disabled,
      isComposing: imeEnterGesture.isComposing,
      resolveTarget,
      textareaRef,
      setCaret,
      setDraft,
      setNotice
    })
    const { imageAttachments, clearImageAttachments } = attachments

    const editor = { setDraft, setCaret, setActiveSuggestion }
    const localHandle = useRef<ComposerHandle>(null)
    const root = useRef<HTMLDivElement>(null)
    const { pickAttachments, handlePasteEvent } = useNativeChatComposerPasteAndDrops({
      handle: localHandle,
      attachments,
      paneKey,
      draftScopeKey,
      targetPtyId,
      structuredTransport,
      terminalTabId,
      disabled,
      setNotice,
      resend: (text, imagePaths) => !structuredTransport && sendPty({ text, imagePaths }),
      textareaRef,
      isComposing: imeEnterGesture.isComposing,
      caret,
      ...editor,
      agent
    })

    const dictation = useNativeChatDictation(textareaRef, disabled)
    // What option commands and PTY sends share to reach, and read, the agent's input line.
    const ptyCommandTarget = {
      agent,
      disabled,
      resolveTarget,
      onSlashCommand,
      onSubmitted,
      readTerminalDraft: launchSeed?.readTerminalDraft
    }
    const sessionOptions = useNativeChatComposerSessionOptions({
      ...ptyCommandTarget,
      terminalTabId,
      targetPtyId,
      onSwitchToTerminal,
      readTerminalScreen,
      paneKey,
      structuredTransport
    })
    const contextUsageSummary = useNativeChatContextUsageSummary(structuredTransport)

    const sendStructured = useNativeChatRoomSend(
      useNativeChatStructuredComposerSend({
        agent,
        draftScopeKey,
        imageAttachments,
        structuredTransport,
        isComposing: imeEnterGesture.isComposing,
        clearSkillOrigin,
        setDraft,
        setCaret
      })
    )

    const ptyCommandRouting = {
      ...ptyCommandTarget,
      ...sessionOptions.ptyCommandRouting,
      answerCommandLocally,
      trackPendingSend,
      setDraft,
      setCaret,
      clearSkillOrigin,
      clearImageAttachments,
      setNotice
    }
    const sendPty = useNativeChatPtyComposerSend({
      draftScopeKey,
      ...ptyCommandRouting,
      draft,
      imageAttachments,
      launchDraft: launchSeed?.launchDraft,
      launchDraftResolved: launchSeed?.launchDraftResolved === true,
      readTerminalScreen,
      classifySend,
      onOptimisticSend,
      optimisticSendOutcome,
      terminalTabId
    })
    const { goalMode, ...submission } = useNativeChatComposerSubmit({
      agent,
      textareaRef,
      structuredTransport,
      draftScopeKey,
      draft,
      caret,
      imageAttachments,
      disabled,
      held: mentions.sendHeld,
      sendPty,
      sendStructured,
      submitEmpty: launchPrompt?.onEmptySubmit,
      orcaCommands: pending || launchPrompt ? undefined : orcaCommands,
      setDraft,
      setCaret
    })

    const { sendHeld, ...sendButton } = nativeChatComposerSendState({
      agent,
      draft,
      messageDelivery: submission.messageDelivery,
      imageAttachments,
      pastedTextSaving: attachments.pastedTextSaving,
      disabled,
      structuredTransport,
      editSession,
      isWorking,
      canStop: hasPty && onStop !== undefined,
      orcaCommand: !pending && !launchPrompt && orcaCommands.matchesDraft(draft),
      goalMode: goalMode.active,
      mentionHold: mentions.sendHeld
    })
    // Why: once a turn settles, an empty composer's Stop ends the background work still running.
    const stopsBackgroundTasks =
      !editSession && !isWorking && !sendButton.hasDraft && onStopBackgroundTasks !== undefined

    const { send, chooseEditItem, fieldOverrides, dispatchPickerCommand } =
      useNativeChatComposerEditSession({
        editSession,
        root,
        handle: localHandle,
        ref,
        draftScopeKey,
        agent,
        disabled,
        sendHeld,
        ...picker,
        structuredTransport,
        sendStructured,
        ptyCommandRouting: { ...ptyCommandRouting, setActiveSuggestion },
        setNotice,
        sendMessage: submission.send
      })

    const interrupt = useNativeChatComposerInterrupt({
      inert: inputOwnedByCard,
      cancelPendingSends,
      isWorking,
      onStop,
      resolveTarget
    })

    const suggestionBlocked =
      disabled || editSession !== undefined || goalMode.active || isWorking || dictation.isDictating
    const promptSuggestion = useNativeChatComposerPromptSuggestion({
      agent,
      structuredTransport,
      targetPtyId,
      paneKey,
      blocked: suggestionBlocked,
      hasImages: imageAttachments.length > 0,
      readTerminalPromptSuggestion,
      isComposing: imeEnterGesture.isComposing,
      draft,
      editor: { textareaRef, ...editor }
    })
    const handleKeyDown = useNativeChatComposerKeyDown({
      acceptPromptSuggestion: promptSuggestion.accept,
      dismissPromptSuggestion: promptSuggestion.dismiss,
      autocomplete: autocomplete,
      mentionFiles: mentions.mentionFiles,
      completeMention: mentions.chooseMention,
      mentionKey: mentions.handleKey,
      activeSuggestion,
      draft,
      recall: editSession ? undefined : recall.recall,
      isComposing: imeEnterGesture.isComposing,
      completePickerItem: editSession ? chooseEditItem : goalMode.interceptPick(completeItem),
      dispatchPickerCommand: editSession
        ? chooseEditItem
        : goalMode.interceptPick(orcaCommands.interceptPick(dispatchPickerCommand)),
      dismissPicker: dismiss,
      interrupt: editSession?.cancel ?? (escapeStops ? interrupt : undefined),
      send,
      hasAttachments: imageAttachments.length > 0,
      ...(!editSession && steerHead ? { steerHead } : {}),
      chordSteersHead: sendButton.chordSteersHead,
      ...editor,
      setActiveSuggestion: picker.navigateSuggestion
    })

    const pickerOpen = autocomplete.mode !== 'none'
    const steerChord = useNativeChatSteerChordPreview(root, sendButton, steerHead, send, pickerOpen)

    const draftEvents = useNativeChatDraftEvents({
      draft,
      ...editor,
      handleDraftOrCaretChange,
      flushDraftAppends,
      flushPendingAttachments: attachments.flushPendingAttachments
    })

    const workspace = { terminalTabId, structuredTransport, isWorking }
    const workspaceFooter =
      editSession || launchPrompt ? undefined : <NativeChatComposerWorkspace {...workspace} />
    return (
      <div ref={root} data-native-chat-composer-scope={draftScopeKey}>
        <NativeChatComposerRoomProvider mentions={mentions}>
          <NativeChatComposerField
            draftScopeKey={draftScopeKey}
            positionTarget={editSession ? undefined : terminalTabId}
            textareaRef={textareaRef}
            sideChat={sideChat}
            draft={draft}
            disabled={disabled}
            hasPty={hasPty}
            canSend={canSend}
            placeholderHint={unavailableHint}
            idleHint={afterStop ? undefined : mentions.hint}
            autocomplete={autocomplete}
            mentionFiles={mentions.listed}
            activeSuggestion={mentions.activeIndex ?? activeSuggestion}
            notices={mentions.notices}
            imageAttachments={imageAttachments}
            numberImages={Boolean(structuredTransport)}
            attachmentEnvironmentId={structuredTransport?.runtimeEnvironmentId ?? undefined}
            {...sendButton}
            promptSuggestion={sendButton.promptSuggestion ?? promptSuggestion.promptSuggestion}
            {...(stopsBackgroundTasks ? { showStop: true, sendButtonDisabled: disabled } : {})}
            isWorking={isWorking}
            isStopping={isStopping}
            afterStop={afterStop}
            attachDisabled={attachDisabled}
            {...nativeChatDictationFieldProps(dictation)}
            imeEnterGesture={imeEnterGesture}
            {...draftEvents}
            onKeyDown={handleKeyDown}
            onPaste={handlePasteEvent}
            pickerListboxId={picker.listboxId}
            onChoosePickerItem={goalMode.interceptPick(orcaCommands.interceptPick(completeItem))}
            goalMode={goalMode}
            onRetrySkills={picker.retrySkills}
            onChooseMentionFile={mentions.chooseMention}
            onRemoveImageAttachment={attachments.removeImageAttachment}
            onAttach={pickAttachments}
            coordinator={coordinatorTargetFor(structuredTransport)}
            onSend={send}
            steerPreview={steerChord.preview}
            onSteerPreview={steerChord.runPreview}
            onStop={stopsBackgroundTasks ? onStopBackgroundTasks : interrupt}
            sessionOptionsSurface={sessionOptions.surface}
            sessionOptionsSnapshot={sessionOptions.snapshot}
            contextUsage={contextUsageSummary}
            sessionOptionsPickerRequest={structuredTransport?.optionPickerRequest ?? null}
            agent={agent}
            launchPrompt={launchPrompt}
            workspaceFooter={workspaceFooter}
            {...fieldOverrides}
          />
        </NativeChatComposerRoomProvider>
      </div>
    )
  }
)
