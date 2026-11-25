import { useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { nativeChatModelDescription } from './native-chat-model-description'
import { useTranslate } from '@/i18n/use-translate'
import type {
  SessionOptionsCliUpdate,
  SessionOptionSelectChoice
} from '../../../../../../../shared/native-chat/input/native-chat-session-options'
import { nativeChatSessionChoiceLabel } from '../../../../../../../shared/native-chat/input/session-options/native-chat-session-option-labels'
import { sayNativeChatSessionOptionTranslated as say } from './native-chat-session-option-labels-text'
import { NativeChatSessionOptionChoiceBody } from './NativeChatSessionOptionChoiceBody'
import { NativeChatSessionOptionWriteGroup } from './NativeChatSessionOptionWriteGroup'
import { NativeChatCursorModelGroups } from './NativeChatCursorModelGroups'
import { AgentPickerLegacyModelsToggle } from '../../../../agent/AgentPickerLegacyModelsToggle'
import { useLegacyModelsExpanded } from '../../../../agent/use-legacy-models-expanded'
import { getModelVariantSuffix, groupCursorModels } from '../../../cursor-model-groups'
import { NativeChatModelNeedsCliUpdateRow } from './NativeChatModelNeedsCliUpdateRow'

type NativeChatModelComboboxProps = {
  choices: readonly SessionOptionSelectChoice[]
  currentValue: string | undefined
  /** Choices stay listed and searchable, but cannot be picked. */
  readOnly: boolean
  readOnlyReason: string | null
  /** A write is in flight; the rows take no pick until it settles, and the search stays usable. */
  busy: boolean
  /** Called for a model other than the current one; the list stays as it is. */
  onSelect: (value: string) => void
  /** The chat agent; when cursor, enables grouped layout. */
  agent?: string
  /** Explicitly enables grouped layout. */
  grouped?: boolean
  /** The chat host's own CLI, too old for models on Orca's list. */
  cliUpdate?: SessionOptionsCliUpdate
}

// Why not cmdk's scorer: it matches scattered letters and reorders the host's list.
function modelChoiceFilter(value: string, search: string, keywords?: string[]): number {
  const haystack = [value, ...(keywords ?? [])].join(' ').toLowerCase()
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean)
  return terms.every((term) => haystack.includes(term)) ? 1 : 0
}

export function NativeChatModelCombobox({
  choices,
  currentValue,
  readOnly,
  readOnlyReason,
  busy,
  onSelect,
  agent,
  grouped,
  cliUpdate
}: NativeChatModelComboboxProps): React.JSX.Element {
  const t = useTranslate()
  const searchLabel = t('components.native-chat.composer.searchModels', 'Search models…')
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const searching = Boolean(query.trim())
  // The current value stays listed even while a pending pick still carries its hidden flag.
  const listed = useMemo(
    () => choices.filter((choice) => searching || !choice.hidden || choice.value === currentValue),
    [choices, currentValue, searching]
  )
  // Fork: Cursor lists Auto, its own models and each vendor's newest model; older ones fold below.
  const isGrouped = grouped ?? agent === 'cursor'
  const groups = useMemo(
    () => (isGrouped ? groupCursorModels(listed.filter((choice) => !choice.legacy)) : null),
    [isGrouped, listed]
  )
  const currentInMoreModels =
    currentValue !== undefined &&
    (groups?.moreModels.some(
      (choice) => choice.value === currentValue || currentValue.startsWith(`${choice.value}-`)
    ) ??
      false)
  const [legacyExpanded, toggleLegacy] = useLegacyModelsExpanded(
    currentInMoreModels || choices.some((choice) => choice.value === currentValue && choice.legacy)
  )
  // Membership ignores the selection, so picking a model never moves rows in the open list.
  const folded = (choice: SessionOptionSelectChoice) => !searching && Boolean(choice.legacy)
  const legacyChoices = listed.filter(folded)
  // A model the CLI already lists is pickable, whatever the list says it needs.
  const needsUpdate = cliUpdate
    ? cliUpdate.models.filter((model) => !choices.some((choice) => choice.value === model.id))
    : []
  const cliUpdateRows = cliUpdate
    ? needsUpdate.map((model) => (
        <NativeChatModelNeedsCliUpdateRow
          key={`cli-update:${model.id}`}
          model={model}
          update={cliUpdate}
        />
      ))
    : []
  const renderChoice = (choice: SessionOptionSelectChoice) => {
    const label = nativeChatSessionChoiceLabel(choice, say)
    const current = choice.value === currentValue
    const suffix = isGrouped ? getModelVariantSuffix(choice.value) : null
    return (
      <CommandItem
        key={choice.value}
        value={choice.value}
        keywords={[label, suffix ?? '', choice.description ?? '']}
        selection="palette"
        disabled={readOnly}
        aria-current={current || undefined}
        onSelect={() => {
          if (!current) {
            onSelect(choice.value)
          }
        }}
      >
        <NativeChatSessionOptionChoiceBody
          label={label}
          suffix={suffix}
          description={nativeChatModelDescription(choice.value, choice.description, t)}
        />
        {/* Reserve the check slot so selecting a model cannot rewrap its label. */}
        <span className="ml-auto flex size-3.5 shrink-0 items-center justify-center">
          {current ? <Check className="size-3.5 text-muted-foreground" /> : null}
        </span>
      </CommandItem>
    )
  }
  return (
    <Command
      surface="inline"
      density="menu"
      label={searchLabel}
      filter={modelChoiceFilter}
      defaultValue={currentValue}
    >
      <CommandInput ref={search} placeholder={searchLabel} value={query} onValueChange={setQuery} />
      {readOnly && readOnlyReason ? (
        <div className="px-3 py-1.5 text-xs text-muted-foreground">{readOnlyReason}</div>
      ) : null}
      <CommandList
        animateHeight
        className="max-h-[min(233px,60vh)] h-[min(var(--cmdk-list-height),233px,60vh)]"
        // cmdk rows override inherited aria-disabled, so announce pending writes on the list too.
        aria-busy={busy}
        // Keep focus in search; model changes can remove or disable the clicked option.
        onMouseDown={(event) => {
          event.preventDefault()
          search.current?.focus()
        }}
      >
        <CommandEmpty>
          {t('components.native-chat.composer.noModelsMatch', 'No models match your search.')}
        </CommandEmpty>
        <NativeChatSessionOptionWriteGroup busy={busy}>
          {groups ? (
            <>
              {cliUpdateRows.length > 0 ? <CommandGroup>{cliUpdateRows}</CommandGroup> : null}
              <NativeChatCursorModelGroups
                groups={groups}
                legacyChoices={listed.filter((choice) => choice.legacy)}
                searching={searching}
                expanded={legacyExpanded}
                onToggle={toggleLegacy}
                renderChoice={renderChoice}
              />
            </>
          ) : (
            <CommandGroup>
              {/* One keyed array, so a row moving between sections keeps its highlight. */}
              {[
                ...cliUpdateRows,
                ...listed.filter((choice) => !folded(choice)).map(renderChoice),
                ...(legacyExpanded ? legacyChoices.map(renderChoice) : []),
                <AgentPickerLegacyModelsToggle
                  key="legacy-toggle"
                  total={legacyChoices.length}
                  expanded={legacyExpanded}
                  selection="palette"
                  onToggle={toggleLegacy}
                />
              ]}
            </CommandGroup>
          )}
        </NativeChatSessionOptionWriteGroup>
      </CommandList>
    </Command>
  )
}
