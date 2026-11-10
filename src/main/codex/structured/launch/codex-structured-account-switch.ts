// Whether a Codex chat's saved history can follow it to another account by hardlink.

import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { isCodexHistorySharedAcrossAccounts } from '../../../codex-accounts/codex-history-sharing'
import { hostAdditionalCodexHomePaths } from '../../../native-chat/host-readable-transcript-path'
import { getSystemCodexHomePath } from '../../configuration/homes/codex-home-paths'

export const CODEX_ACCOUNT_SWITCH_FAILED =
  "Orca couldn't move this chat's Codex history into the selected account. Switch back to the account this chat ran under, or hand it off to another agent."

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

async function sessionsVolume(home: string): Promise<number | null> {
  for (const path of [join(home, 'sessions'), home]) {
    try {
      return (await stat(path)).dev
    } catch (error) {
      if (!isMissing(error)) {
        throw error
      }
    }
  }
  return null
}

/** Whether a chat pinned to `recordHome` can move to any selectable account: history sharing must
 *  be on, and a hardlink needs every home on one volume. Homes not created yet are left to the
 *  launch to refuse. */
export async function codexChatAccountSwitchable(
  recordHome: string,
  settings: Pick<GlobalSettings, 'codexShareHistoryAcrossAccounts'>
): Promise<boolean> {
  if (!isCodexHistorySharedAcrossAccounts(settings)) {
    return false
  }
  const [own, ...selectable] = await Promise.all(
    [recordHome, ...hostAdditionalCodexHomePaths(), getSystemCodexHomePath()].map(sessionsVolume)
  )
  return own !== null && selectable.every((volume) => volume === null || volume === own)
}
