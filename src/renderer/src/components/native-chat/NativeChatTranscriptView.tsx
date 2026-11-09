import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Tab } from '../../../../shared/tab-types'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { findCursorTranscriptTerminal } from '@/lib/cursor-transcript-terminal'
import { getKnownExecutionHostIdForWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner'
import { NativeChatResolvedView } from './NativeChatResolvedView'
import { NativeChatFileLinkExistenceProvider } from './use-native-chat-file-link-existence'
import { CursorTranscriptComposer } from './CursorTranscriptComposer'
import { useCursorTranscriptResume } from './use-cursor-transcript-resume'
import { useNativeChatRetainedSession } from './use-native-chat-retained-session'
import { useNativeChatFontSize } from './use-native-chat-font-size'
import { NATIVE_CHAT_APPEARANCE_ROOT_CLASS } from './native-chat-appearance-style'
import { useNativeChatStoreAppearanceStyle } from './use-native-chat-store-appearance-style'
import { cn } from '@/lib/utils'
import { useNativeChatImageRuntimeContext } from './native-chat-image-runtime-context'
import { selectNativeChatViewState } from './native-chat-view-state'
import { NativeChatMessageList } from './NativeChatMessageList'
import { NativeChatEmptyState } from './NativeChatEmptyState'
import { reconcileCursorTranscriptTabs } from '@/lib/cursor-transcript-tab'
import {
  readNativeChatComposerDraft,
  subscribeToNativeChatComposerDraft
} from './native-chat-composer-draft-store'

export function NativeChatTranscriptView({
  tabId,
  worktreeId,
  source,
  isVisible,
  isFocusedGroup
}: {
  tabId: string
  worktreeId: string
  source: NonNullable<Tab['agentTranscript']>
  isVisible: boolean
  isFocusedGroup: boolean
}): React.JSX.Element {
  const [sending, setSending] = useState(false)
  const subscribeDraft = useCallback(
    (listener: () => void) => subscribeToNativeChatComposerDraft(tabId, listener),
    [tabId]
  )
  const draft = useSyncExternalStore(subscribeDraft, () => readNativeChatComposerDraft(tabId))
  const terminal = useAppStore(
    useShallow((state) =>
      getKnownExecutionHostIdForWorktree(state, worktreeId) ===
      (source.runtimeEnvironmentId ? `runtime:${source.runtimeEnvironmentId}` : 'local')
        ? findCursorTranscriptTerminal(state, worktreeId, source.sessionId)
        : null
    )
  )
  useEffect(() => {
    if (terminal && !sending && draft.text === '' && draft.images.length === 0) {
      reconcileCursorTranscriptTabs(worktreeId)
    }
  }, [terminal, sending, draft, worktreeId])
  if (terminal && !sending) {
    return (
      <NativeChatFileLinkExistenceProvider tabId={terminal.tabId}>
        <NativeChatResolvedView
          terminalTabId={terminal.tabId}
          paneKey={terminal.paneKey}
          draftScopeKey={tabId}
          targetPtyId={terminal.ptyId}
          agent={source.agent}
          sessionId={source.sessionId}
          transcriptPath={source.transcriptPath}
          isVisible={isVisible}
          isFocusedGroup={isFocusedGroup}
          ownsTabWideLaunchDraft={false}
        />
      </NativeChatFileLinkExistenceProvider>
    )
  }
  return (
    <ExternalCursorTranscriptView
      tabId={tabId}
      worktreeId={worktreeId}
      source={source}
      isVisible={isVisible}
      isFocusedGroup={isFocusedGroup}
      onSendingChange={setSending}
    />
  )
}

function ExternalCursorTranscriptView({
  tabId,
  worktreeId,
  source,
  isVisible,
  isFocusedGroup,
  onSendingChange
}: Parameters<typeof NativeChatTranscriptView>[0] & {
  onSendingChange: (sending: boolean) => void
}): React.JSX.Element {
  const session = useNativeChatRetainedSession({
    ...source,
    paneKey: tabId,
    enabled: isVisible
  })
  const rootRef = useRef<HTMLDivElement>(null)
  useNativeChatFontSize(isVisible && isFocusedGroup, rootRef)
  const appearanceStyle = useNativeChatStoreAppearanceStyle()
  const runtimeContext = useNativeChatImageRuntimeContext(tabId)
  const view = selectNativeChatViewState(session)
  const resume = useCursorTranscriptResume({
    worktreeId,
    sessionId: source.sessionId,
    enabled: isVisible
  })
  return (
    <div
      ref={rootRef}
      className={cn(NATIVE_CHAT_APPEARANCE_ROOT_CLASS, 'flex h-full min-h-0 w-full flex-col')}
      style={appearanceStyle}
      data-native-chat-scheme={appearanceStyle.colorScheme}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {view.kind === 'ready' ? (
          <NativeChatMessageList
            session={session}
            isVisible={isVisible}
            isWorking={false}
            expandSignal={false}
            runtimeContext={runtimeContext}
          />
        ) : (
          <NativeChatEmptyState
            kind={view.kind}
            message={view.kind === 'error' ? view.message : undefined}
            agent={source.agent}
          />
        )}
      </div>
      <CursorTranscriptComposer
        scopeKey={tabId}
        ready={resume.resumable}
        resume={resume.resume}
        onSendingChange={onSendingChange}
      />
    </div>
  )
}
