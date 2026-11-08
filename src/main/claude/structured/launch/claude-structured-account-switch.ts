import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { getClaudeProfileRouter } from '../../../claude-accounts/claude-profile-installed-router'

/** Claude resumes from its projects folder, so every selectable account must share the chat's. */
export async function claudeChatAccountSwitchable(input: {
  store: string
  launchEnv: NodeJS.ProcessEnv
}): Promise<boolean> {
  const router = getClaudeProfileRouter()
  if (!router) {
    return false
  }
  const homes = await router.accountSelectionHomes(input.launchEnv)
  const roots = await Promise.all(
    [input.store, ...homes.map((home) => join(home, 'projects'))].map((root) => realpath(root))
  )
  return roots.every((root) => root === roots[0])
}
