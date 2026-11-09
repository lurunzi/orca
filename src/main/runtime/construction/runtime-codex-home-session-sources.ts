import { configureAiVaultSessionSources } from '../../ai-vault/cached-session-list'
import { configureHostReadableTranscriptPathSources } from '../../native-chat/host-readable-transcript-path'

/** Headless serve skips registerCoreHandlers but still needs managed-Codex/WSL AiVault sources. */
export function configureRuntimeCodexHomeSessionSources(
  getAdditionalCodexHomePaths: (() => readonly string[]) | undefined
): void {
  if (!getAdditionalCodexHomePaths) {
    return
  }
  configureAiVaultSessionSources({ getAdditionalCodexHomePaths })
  configureHostReadableTranscriptPathSources({ getAdditionalCodexHomePaths })
}
