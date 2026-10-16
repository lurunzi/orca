import { useRef } from 'react'
import { Play } from 'lucide-react'
import type { Tab } from '../../../../shared/tab-types'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
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
      <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
        {translate('components.native-chat.externalTranscript', 'External session · Read-only')}
        {resume.resumable ? (
          <Button variant="secondary" size="xs" onClick={resume.resume}>
            <Play className="size-3.5" />
            {translate(
              'auto.components.right.sidebar.AiVaultSessionRow.resumeInNewTab',
              'Resume in New Tab'
            )}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
