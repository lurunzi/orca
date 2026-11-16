import { CommandGroup } from '@/components/ui/command'
import { useTranslate } from '@/i18n/use-translate'
import type { SessionOptionSelectChoice } from '../../../../../../../shared/native-chat/input/native-chat-session-options'
import type { CursorModelGroups } from '../../../cursor-model-groups'
import { AgentPickerLegacyModelsToggle } from '../../../../agent/AgentPickerLegacyModelsToggle'

/** Fork: Cursor's model list in the official picker's sections; older and legacy models fold
 *  under the shared "More models" row. */
export function NativeChatCursorModelGroups({
  groups,
  legacyChoices,
  searching,
  expanded,
  onToggle,
  renderChoice
}: {
  groups: CursorModelGroups
  legacyChoices: readonly SessionOptionSelectChoice[]
  searching: boolean
  expanded: boolean
  onToggle: () => void
  renderChoice: (choice: SessionOptionSelectChoice) => React.JSX.Element
}): React.JSX.Element {
  const t = useTranslate()
  const more = [...groups.moreModels, ...legacyChoices]
  // A search lists every match; the fold only applies to the browsing list.
  const showMore = searching || expanded
  return (
    <>
      {groups.autoModel ? <CommandGroup>{renderChoice(groups.autoModel)}</CommandGroup> : null}
      {groups.cursorModels.length > 0 ? (
        <CommandGroup heading={t('components.native-chat.composer.cursorModels', 'Cursor Models')}>
          {groups.cursorModels.map(renderChoice)}
        </CommandGroup>
      ) : null}
      {groups.otherModels.length > 0 ? (
        <CommandGroup heading={t('components.native-chat.composer.otherModels', 'Other Models')}>
          {groups.otherModels.map(renderChoice)}
        </CommandGroup>
      ) : null}
      <CommandGroup>
        {[
          ...(showMore ? more.map(renderChoice) : []),
          <AgentPickerLegacyModelsToggle
            key="legacy-toggle"
            total={searching ? 0 : more.length}
            expanded={expanded}
            selection="palette"
            onToggle={onToggle}
          />
        ]}
      </CommandGroup>
    </>
  )
}
