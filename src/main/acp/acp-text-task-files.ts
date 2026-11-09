import { rm } from 'node:fs/promises'
import { removeAntigravitySignInSessionFiles } from '../antigravity/antigravity-sign-in-session-files'
import type { AcpLaunchSpec } from './acp-launch-specs'

export async function removeAcpTextTaskFiles(
  spec: Pick<AcpLaunchSpec, 'agent' | 'managedRuntime'>,
  home: string,
  sessionId: string,
  cwd: string
): Promise<void> {
  // Only the managed server's private home is Orca's to clean; agy keeps its own history.
  if (spec.agent === 'antigravity' && spec.managedRuntime) {
    await removeAntigravitySignInSessionFiles(home, sessionId, cwd)
  }
  await rm(cwd, { recursive: true, force: true })
}
