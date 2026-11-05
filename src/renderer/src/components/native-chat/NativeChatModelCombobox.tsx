import { useMemo, useRef, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { nativeChatModelDescription } from './native-chat-model-description'
import { translate } from '@/i18n/i18n'
import type { SessionOptionSelectChoice } from '../../../../shared/native-chat/input/native-chat-session-options'
import { nativeChatSessionChoiceLabel } from '../../../../shared/native-chat/input/native-chat-session-option-labels'
import { sayNativeChatSessionOptionTranslated as say } from './native-chat-session-option-labels-text'
import { NativeChatSessionOptionChoiceBody } from './NativeChatSessionOptionChoiceBody'
import { NativeChatSessionOptionWriteGroup } from './NativeChatSessionOptionWriteGroup'
import { getModelVariantSuffix, groupCursorModels } from './cursor-model-groups'

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
  grouped
}: NativeChatModelComboboxProps): React.JSX.Element {
  const searchLabel = translate('components.native-chat.composer.searchModels', 'Search models…')
  const search = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [expanded, setExpanded] = useState(false)

  const isGrouped = grouped ?? agent === 'cursor'
  const groups = useMemo(
    () => (isGrouped ? groupCursorModels(choices, currentValue) : null),
    [isGrouped, choices, currentValue]
  )

  const hasSearch = searchQuery.trim().length > 0
  const showMoreModels = expanded || hasSearch

  const renderModelItem = (choice: SessionOptionSelectChoice): React.JSX.Element => {
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
          description={nativeChatModelDescription(choice.value, choice.description)}
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
      <CommandInput ref={search} placeholder={searchLabel} onValueChange={setSearchQuery} />
      {readOnly && readOnlyReason ? (
        <div className="px-3 py-1.5 text-xs text-muted-foreground">{readOnlyReason}</div>
      ) : null}
      <CommandList
        animateHeight
        // cmdk rows override inherited aria-disabled, so announce pending writes on the list too.
        aria-busy={busy}
        // Keep focus in search; model changes can remove or disable the clicked option.
        onMouseDown={(event) => {
          event.preventDefault()
          search.current?.focus()
        }}
      >
        <CommandEmpty>
          {translate(
            'components.native-chat.composer.noModelsMatch',
            'No models match your search.'
          )}
        </CommandEmpty>
        <NativeChatSessionOptionWriteGroup busy={busy}>
          {!isGrouped || !groups ? (
            <CommandGroup>{choices.map(renderModelItem)}</CommandGroup>
          ) : (
            <>
              {groups.autoModel ? (
                <CommandGroup>{renderModelItem(groups.autoModel)}</CommandGroup>
              ) : null}
              {groups.cursorModels.length > 0 ? (
                <CommandGroup
                  heading={translate(
                    'components.native-chat.composer.cursorModels',
                    'Cursor Models'
                  )}
                >
                  {groups.cursorModels.map(renderModelItem)}
                </CommandGroup>
              ) : null}
              {groups.otherModels.length > 0 ? (
                <CommandGroup
                  heading={translate('components.native-chat.composer.otherModels', 'Other Models')}
                >
                  {groups.otherModels.map(renderModelItem)}
                </CommandGroup>
              ) : null}
              {showMoreModels ? (
                groups.moreModels.length > 0 ? (
                  <CommandGroup
                    heading={translate('components.native-chat.composer.moreModels', 'More models')}
                  >
                    {groups.moreModels.map(renderModelItem)}
                  </CommandGroup>
                ) : null
              ) : groups.moreModels.length > 0 ? (
                <CommandGroup>
                  <CommandItem
                    value="more-models"
                    keywords={[]}
                    selection="palette"
                    onSelect={() => setExpanded(true)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {translate('components.native-chat.composer.moreModels', 'More models')}
                    </span>
                    <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
                  </CommandItem>
                </CommandGroup>
              ) : null}
            </>
          )}
        </NativeChatSessionOptionWriteGroup>
      </CommandList>
    </Command>
  )
}
