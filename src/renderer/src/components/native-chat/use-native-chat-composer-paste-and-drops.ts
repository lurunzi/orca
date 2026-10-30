import { useNativeChatComposerHandle } from './use-native-chat-composer-handle'
import { useNativeChatFileDrops } from './use-native-chat-file-drops'
import type { useNativeChatComposerAttachments } from './use-native-chat-composer-attachments'

type FileDropArgs = Parameters<typeof useNativeChatFileDrops>[0]
type HandleArgs = Parameters<typeof useNativeChatComposerHandle>[1]

type UseNativeChatComposerPasteAndDropsArgs = Pick<
  FileDropArgs,
  | 'paneKey'
  | 'draftScopeKey'
  | 'targetPtyId'
  | 'structuredTransport'
  | 'terminalTabId'
  | 'disabled'
  | 'setNotice'
> &
  Pick<
    HandleArgs,
    | 'textareaRef'
    | 'isComposing'
    | 'caret'
    | 'setDraft'
    | 'setCaret'
    | 'setActiveSuggestion'
    | 'agent'
  > & {
    handle: Parameters<typeof useNativeChatComposerHandle>[0]
    attachments: ReturnType<typeof useNativeChatComposerAttachments>
  }

/** Route file drops and pastes into the composer's draft and attachments. */
export function useNativeChatComposerPasteAndDrops({
  handle,
  attachments,
  paneKey,
  draftScopeKey,
  targetPtyId,
  structuredTransport,
  terminalTabId,
  disabled,
  setNotice,
  textareaRef,
  isComposing,
  caret,
  setDraft,
  setCaret,
  setActiveSuggestion,
  agent
}: UseNativeChatComposerPasteAndDropsArgs) {
  const { attachResolvedPaths } = attachments
  const {
    pickAttachments,
    attachExternalPaths,
    captureExternalPaths,
    captureCopiedFiles,
    resolveAttachmentOwner
  } = useNativeChatFileDrops({
    paneKey,
    draftScopeKey,
    targetPtyId,
    structuredTransport,
    terminalTabId,
    structuredWorktreeId: structuredTransport?.worktreeId,
    structuredSession: structuredTransport,
    disabled,
    attachResolvedPaths,
    pendingChips: attachments.pendingChips,
    setNotice
  })
  const handlePasteEvent = useNativeChatComposerHandle(handle, {
    attachmentScopeKey: draftScopeKey,
    textareaRef,
    isComposing,
    caret,
    setDraft,
    setCaret,
    setActiveSuggestion,
    targetKey: JSON.stringify([
      paneKey,
      targetPtyId,
      structuredTransport?.sessionId,
      structuredTransport?.worktreeId,
      structuredTransport?.runtimeEnvironmentId
    ]),
    agent,
    disabled,
    resolveAttachmentOwner,
    attachResolvedPaths,
    attachCopiedFiles: attachExternalPaths,
    captureCopiedFiles,
    captureExternalPaths,
    beginPendingImageAttachment: attachments.beginPendingImageAttachment,
    // Settles into the scope cache, which outlives a composer a prompt card unmounted.
    resolvePendingImageAttachment: attachments.pendingChips.resolve,
    revealPendingImageAttachment: attachments.revealPendingImageAttachment,
    dropPendingImageAttachment: attachments.dropPendingImageAttachment,
    pastedTextEditor: structuredTransport ? attachments.scopeEditor : null,
    setNotice
  })
  return { pickAttachments, handlePasteEvent }
}
