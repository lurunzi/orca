// Let a Codex chat start under the account selected now, carrying its rollout there by hardlink.

import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeRuntimePathForComparison } from '../../../../shared/cross-platform-path'
import { applyStructuredCodexWorkspaceTrust } from '../../../agent-launch/trust/agent-workspace-trust-spawn'
import { resolveSessionFilePath } from '../../../native-chat/session-file-resolver'
import { resolveStructuredCodexAccountHomePath } from '../../../runtime/agent-session/environment/structured-agent-account-home'
import { prepareCodexAccountRestartResume } from '../../history/resume/codex-legacy-session-resume'

/** The desktop services a Codex chat start needs to follow the account selection. */
export type CodexStructuredAccountSwitch = {
  /** Whether chats follow the selection: history sharing lets their rollout move with them. */
  isEnabled: () => boolean
  /** The selected account's launch home, prepared for a launch; null is the system home. */
  prepareLaunchHome: (input: { launchEnv: NodeJS.ProcessEnv }) => Promise<string | null>
  /** Every host home a selection can name now. */
  selectableHomes: () => string[]
  systemHomePath: () => string
  /** Hooks and daemon-socket guard for a home the selected-account preparation did not set up. */
  preparePinnedLaunchHome: (home: string) => Promise<void>
  workspaceTrustSettings: () => Parameters<typeof applyStructuredCodexWorkspaceTrust>[0]['settings']
}

let installed: CodexStructuredAccountSwitch | undefined

/** Installed only by the desktop runtime; absent, every chat keeps the account it was created on. */
export function installCodexStructuredAccountSwitch(
  accountSwitch: CodexStructuredAccountSwitch | undefined
): void {
  installed = accountSwitch
}

export function codexStructuredLaunchFollowsSelection(): boolean {
  return installed?.isEnabled() === true
}

const SWITCH_FAILED =
  "Orca couldn't move this chat's Codex history into the selected account. Switch back to the account this chat ran under, or hand it off to another agent."

function sameHome(left: string, right: string): boolean {
  return normalizeRuntimePathForComparison(left) === normalizeRuntimePathForComparison(right)
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

async function findRollout(
  threadId: string,
  homes: readonly string[]
): Promise<{ home: string; path: string } | null> {
  for (const home of homes) {
    const path = await resolveSessionFilePath('codex', threadId, {
      codexSessionsDirs: [join(home, 'sessions')],
      strictErrors: true
    })
    if (path) {
      return { home, path }
    }
  }
  return null
}

/** The home a start of this chat launches under: the selected account's once the thread's rollout
 *  is hardlinked into it. Never falls back to the record's home after the selection moved. */
export async function resolveCodexStructuredLaunchHome(input: {
  recordHome: string
  threadId: string | null
  launchEnv: NodeJS.ProcessEnv
  launchDirectory: () => Promise<string>
}): Promise<string> {
  const accountSwitch = installed
  if (!accountSwitch?.isEnabled()) {
    return input.recordHome
  }
  // An unreadable selection fails the start in its own words, as it fails a create.
  const target = await resolveStructuredCodexAccountHomePath({
    launchEnv: input.launchEnv,
    resolveLaunchHome: accountSwitch.prepareLaunchHome
  })
  if (sameHome(target, input.recordHome)) {
    return target
  }
  // A selection made for terminals must not strand a chat its history cannot follow.
  if (!(await codexChatAccountSwitchable(input.recordHome).catch(() => false))) {
    return input.recordHome
  }
  try {
    const others = accountSwitch.selectableHomes().filter((home) => !sameHome(home, target))
    const rollout = input.threadId
      ? await findRollout(input.threadId, [input.recordHome, ...others])
      : null
    if (rollout) {
      await prepareCodexAccountRestartResume({
        sourceHome: rollout.home,
        transcriptPath: rollout.path,
        targetHome: target,
        systemCodexHomePath: accountSwitch.systemHomePath(),
        hardlinkOnly: true
      })
    }
    await accountSwitch.preparePinnedLaunchHome(target)
    await applyStructuredCodexWorkspaceTrust({
      workspacePath: await input.launchDirectory(),
      launchEnv: input.launchEnv,
      codexHome: target,
      settings: accountSwitch.workspaceTrustSettings()
    })
    return target
  } catch (error) {
    console.warn('[codex-structured-account-switch] could not start under the selection', error)
    // No cause: launch-preparation Details show the deepest message, and this one names the fix.
    throw new Error(SWITCH_FAILED)
  }
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

/** Whether a chat pinned to `recordHome` can move to any selectable account: a hardlink needs
 *  every home on one volume. Homes not created yet are left to the launch to refuse. */
export async function codexChatAccountSwitchable(recordHome: string): Promise<boolean> {
  const accountSwitch = installed
  if (!accountSwitch?.isEnabled()) {
    return false
  }
  const [own, ...selectable] = await Promise.all(
    [recordHome, ...accountSwitch.selectableHomes()].map(sessionsVolume)
  )
  return own !== null && selectable.every((volume) => volume === null || volume === own)
}
