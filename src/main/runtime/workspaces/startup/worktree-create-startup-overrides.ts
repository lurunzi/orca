import type { WorktreeStartupLaunch } from '../../../../shared/worktree/launch-types'
import type { RuntimeManagedWorktreeCreateArgs } from '../creation/runtime-managed-worktree-create-types'

/** Applies the create request's view mode and account env over the agent-built startup. */
export function withWorktreeCreateStartupOverrides<T extends { startup: WorktreeStartupLaunch }>(
  built: T,
  args: Pick<RuntimeManagedWorktreeCreateArgs, 'startupAccountEnv' | 'startupViewMode'>
): T {
  return args.startupAccountEnv || args.startupViewMode
    ? {
        ...built,
        startup: {
          ...built.startup,
          ...(args.startupViewMode ? { viewMode: args.startupViewMode } : {}),
          ...(args.startupAccountEnv
            ? { env: { ...built.startup.env, ...args.startupAccountEnv } }
            : {})
        }
      }
    : built
}
