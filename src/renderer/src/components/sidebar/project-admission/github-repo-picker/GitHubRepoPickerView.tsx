import React, { useMemo, useState } from 'react'
import { ChevronsUpDown, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { GhSignedOutLine } from '@/components/bots/github/GhSignedOutLine'
import type { GitHubAccessibleRepo } from '../../../../../../shared/github/repositories/accessible-repos'

export type GitHubRepoPickerState =
  | { status: 'loading' }
  | { status: 'ready'; repos: GitHubAccessibleRepo[]; truncated: boolean }
  | { status: 'auth_required' }
  | { status: 'error'; message: string }

type GitHubRepoPickerViewProps = {
  state: GitHubRepoPickerState
  /** Where gh runs, for the signed-out line. */
  hostLabel: string
  selectedUrl: string
  disabled?: boolean
  defaultOpen?: boolean
  onPick: (repo: GitHubAccessibleRepo) => void
}

function matchesQuery(repo: GitHubAccessibleRepo, terms: string[]): boolean {
  const haystack = repo.fullName.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export function GitHubRepoPickerView({
  state,
  hostLabel,
  selectedUrl,
  disabled = false,
  defaultOpen = false,
  onPick
}: GitHubRepoPickerViewProps): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(defaultOpen)
  const [query, setQuery] = useState('')
  const repos = state.status === 'ready' ? state.repos : null
  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return repos ? repos.filter((repo) => matchesQuery(repo, terms)) : []
  }, [repos, query])
  const selected = repos?.find((repo) => repo.cloneUrl === selectedUrl) ?? null

  if (state.status === 'auth_required') {
    return <GhSignedOutLine host={hostLabel} />
  }

  const triggerLabel =
    state.status === 'loading'
      ? t('auto.components.sidebar.AddRepoSteps.githubRepoLoading', 'Loading repositories…')
      : state.status === 'error'
        ? state.message
        : (selected?.fullName ??
          t('auto.components.sidebar.AddRepoSteps.githubRepoChoose', 'Choose a repository'))

  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted-foreground">
        {t('auto.components.sidebar.AddRepoSteps.githubRepoLabel', 'GitHub repository')}
      </label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setQuery('')
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || state.status !== 'ready'}
            className="w-full justify-between"
          >
            <span
              className={cn(
                'min-w-0 truncate text-xs font-normal',
                !selected && 'text-muted-foreground'
              )}
            >
              {triggerLabel}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          tone="menu"
          className="w-[var(--radix-popover-trigger-width)] min-w-[280px]"
        >
          <Command shouldFilter={false} surface="menu" density="menu">
            <CommandInput
              autoFocus
              variant="menu"
              placeholder={t(
                'auto.components.sidebar.AddRepoSteps.githubRepoSearch',
                'Search repositories...'
              )}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>
                {t(
                  'auto.components.sidebar.AddRepoSteps.githubRepoNoMatch',
                  'No repositories match. Paste a URL below instead.'
                )}
              </CommandEmpty>
              {filtered.map((repo) => (
                <CommandItem
                  key={repo.cloneUrl}
                  value={repo.cloneUrl}
                  density="menu"
                  selection="menu"
                  onSelect={() => {
                    onPick(repo)
                    setOpen(false)
                    setQuery('')
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted-foreground">{repo.owner}/</span>
                    {repo.name}
                  </span>
                  {repo.private && (
                    <Lock
                      className="size-3 text-muted-foreground"
                      aria-label={t(
                        'auto.components.sidebar.AddRepoSteps.githubRepoPrivate',
                        'Private'
                      )}
                    />
                  )}
                </CommandItem>
              ))}
            </CommandList>
            {state.status === 'ready' && state.truncated && (
              <p className="border-t border-border px-2.5 py-[5px] text-[12px] leading-4 text-muted-foreground">
                {t(
                  'auto.components.sidebar.AddRepoSteps.githubRepoTruncated',
                  'Showing recently pushed repositories. Paste a URL for others.'
                )}
              </p>
            )}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
