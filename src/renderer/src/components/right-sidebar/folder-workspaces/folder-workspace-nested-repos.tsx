import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { FolderGit2, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import { getRepoExecutionHostId } from '../../../../../shared/execution-host/execution-host'
import { normalizeRuntimePathForComparison } from '../../../../../shared/file-access/cross-platform-path'
import type { FolderWorkspace } from '../../../../../shared/folder-workspaces/folder-workspace-types'
import type { NestedRepoScanResult } from '../../../../../shared/project/groups/project-group-types'
import { createNestedRepoScanId } from '../../sidebar/project-admission/dialog/add-repo-dialog-types'
import { worktreeRefreshOptions } from '../../sidebar/project-admission/host-selection/add-repo-runtime-owner'
import {
  toastNoNestedRepositoriesImported,
  toastSomeNestedRepositoriesFailed
} from '../../sidebar/project-admission/nested-import/nested-import-result-toasts'
import { getNestedScanHostOwner } from '../../sidebar/worktree-list/rows/project-group-folder-refresh'
import { FOLDER_WORKTREE_CARD_CLASS } from './folder-worktree-section-header'

type CompletedScan = { scan: NestedRepoScanResult; scanId: string }

type FolderWorkspaceNestedReposProps = {
  folderWorkspace: FolderWorkspace
  /** Bumped by the panel's refresh button; the scan runs only on open and on refresh. */
  refreshKey: number
  className?: string
}

/** Kept outside the component: React Compiler cannot compile try/finally. */
async function importFolderNestedRepos(
  completed: CompletedScan,
  paths: string[],
  runtimeEnvironmentId: string | null
): Promise<void> {
  const store = useAppStore.getState()
  // Same contract as host auto-registration: one folder-scan group rooted at the folder, reused on rescans.
  const result = await store.importNestedRepos({
    parentPath: completed.scan.selectedPath,
    groupName: '',
    projectPaths: paths,
    scanId: completed.scanId,
    runtimeEnvironmentId,
    mode: 'group'
  })
  if (!result) {
    return
  }
  const fetchOptions = worktreeRefreshOptions(runtimeEnvironmentId, null)
  for (const entry of result.projects) {
    if (entry.projectId && entry.status !== 'failed') {
      await store.fetchWorktrees(entry.projectId, fetchOptions)
    }
  }
  if (result.importedCount + result.alreadyKnownCount === 0) {
    toastNoNestedRepositoriesImported(result.projects.find((entry) => entry.status === 'failed'))
  } else if (result.failedCount > 0) {
    toastSomeNestedRepositoriesFailed(result.failedCount)
  }
}

/** Git repos the existing nested scanner finds under the folder that are not projects yet. */
export const FolderWorkspaceNestedRepos = memo(function FolderWorkspaceNestedRepos({
  folderWorkspace,
  refreshKey,
  className
}: FolderWorkspaceNestedReposProps): React.JSX.Element | null {
  const t = useTranslate()
  const repos = useAppStore((state) => state.repos)
  const owner = getNestedScanHostOwner(folderWorkspace)
  const ownerId = owner?.id ?? null
  const runtimeEnvironmentId = owner?.runtimeEnvironmentId ?? null
  const folderPath = folderWorkspace.folderPath
  const [completed, setCompleted] = useState<CompletedScan | null>(null)
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!ownerId) {
      setCompleted(null)
      return
    }
    let live = true
    const scanId = createNestedRepoScanId()
    const { scanNestedRepos, cancelNestedRepoScan } = useAppStore.getState()
    void scanNestedRepos(folderPath, undefined, { scanId, runtimeEnvironmentId }).then((scan) => {
      // A failed scan (including method_not_found on an older host) hides the section.
      if (live) {
        setCompleted(scan?.selectedPathKind === 'non_git_folder' ? { scan, scanId } : null)
      }
    })
    return () => {
      live = false
      void cancelNestedRepoScan(scanId, { runtimeEnvironmentId })
    }
  }, [ownerId, runtimeEnvironmentId, folderPath, refreshKey])

  const candidates = useMemo(() => {
    if (!completed || !ownerId) {
      return []
    }
    const known = new Set(
      repos
        .filter((repo) => getRepoExecutionHostId(repo) === ownerId)
        .map((repo) => normalizeRuntimePathForComparison(repo.path))
    )
    return completed.scan.repos.filter(
      (candidate) => !known.has(normalizeRuntimePathForComparison(candidate.path))
    )
  }, [completed, ownerId, repos])

  if (!completed || candidates.length === 0) {
    return null
  }

  const manage = (paths: string[]): void => {
    setPending((current) => new Set([...current, ...paths]))
    void importFolderNestedRepos(completed, paths, runtimeEnvironmentId).finally(() => {
      if (mounted.current) {
        setPending((current) => new Set([...current].filter((path) => !paths.includes(path))))
      }
    })
  }

  const manageAsProject = t(
    'auto.components.rightSidebar.FolderWorkspaceSourceControl.manageAsProject',
    'Manage as project'
  )
  return (
    <section
      className={cn(FOLDER_WORKTREE_CARD_CLASS, 'py-1 text-left', className)}
      data-folder-nested-repos=""
    >
      <div className="flex min-w-0 items-center gap-2 py-1 pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {t(
            'auto.components.rightSidebar.FolderWorkspaceSourceControl.nestedReposTitle',
            'Repositories found in this folder'
          )}
        </span>
        {candidates.length > 1 ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={pending.size > 0}
            onClick={() => void manage(candidates.map((candidate) => candidate.path))}
          >
            {t('auto.components.rightSidebar.FolderWorkspaceSourceControl.manageAll', 'Manage all')}
          </Button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-0.5 px-1">
        {candidates.map((candidate) => {
          const busy = pending.has(candidate.path)
          return (
            <li
              key={candidate.path}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1 hover:bg-accent/50"
            >
              <span className="flex min-w-16 flex-1 items-center gap-2">
                <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span
                  className="min-w-0 flex-1 truncate text-xs text-foreground"
                  title={candidate.path}
                >
                  {candidate.displayName}
                </span>
              </span>
              <Button
                variant="outline"
                size="xs"
                disabled={busy || pending.size > 0}
                onClick={() => void manage([candidate.path])}
              >
                {busy ? <LoaderCircle className="animate-spin" /> : null}
                {manageAsProject}
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
})
