import type { Tab } from '../../../../shared/tab-types'
import { translate } from '@/i18n/i18n'
import { useNativeChatRetainedSession } from './use-native-chat-retained-session'
import { useNativeChatFontScale } from './use-native-chat-font-scale'
import { useNativeChatImageRuntimeContext } from './native-chat-image-runtime-context'
import { selectNativeChatViewState } from './native-chat-view-state'
import { NativeChatMessageList } from './NativeChatMessageList'
import { NativeChatEmptyState } from './NativeChatEmptyState'

export function NativeChatTranscriptView({
  tabId,
  source,
  isVisible,
  isFocusedGroup
}: {
  tabId: string
  source: NonNullable<Tab['agentTranscript']>
  isVisible: boolean
  isFocusedGroup: boolean
}): React.JSX.Element {
  const session = useNativeChatRetainedSession({
    ...source,
    paneKey: tabId,
    enabled: isVisible
  })
  const fontScale = useNativeChatFontScale(isVisible && isFocusedGroup)
  const runtimeContext = useNativeChatImageRuntimeContext(tabId)
  const view = selectNativeChatViewState(session)
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex min-h-0 flex-1 flex-col">
        {view.kind === 'ready' ? (
          <NativeChatMessageList
            session={session}
            isVisible={isVisible}
            isWorking={false}
            expandSignal={false}
            fontScale={fontScale.scale}
            showTurnStatus={false}
            showLiveTurnActivity={false}
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
      <div className="px-4 py-2 text-xs text-muted-foreground">
        {translate('components.native-chat.externalTranscript', 'External session · Read-only')}
      </div>
    </div>
  )
}
