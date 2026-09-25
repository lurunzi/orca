import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import { ChoiceBody, PickerTrigger } from './NativeChatPickerTrigger'
import {
  tieredRowTargetValue,
  type ModelPickerRow,
  type ModelTierChoice
} from './native-chat-model-tier-groups'
import { nativeChatSessionChoiceLabel } from './native-chat-session-option-labels'

type TieredRow = Extract<ModelPickerRow, { kind: 'tiered' }>

function tierChoiceLabel(tier: ModelTierChoice): string {
  return nativeChatSessionChoiceLabel({ value: tier.tier, label: tier.tierLabel })
}

/** Model rows where tier siblings collapse into one row; the tier pill picks among them. */
export function ModelTierMenuRows(props: {
  rows: readonly ModelPickerRow[]
  currentValue: string | undefined
  currentTier: string | null
  disabled: boolean
  setValue: (value: string) => void
}): React.JSX.Element {
  return (
    <DropdownMenuRadioGroup
      aria-label={translate('components.native-chat.composer.model', 'Model')}
      value={props.currentValue}
      onValueChange={props.setValue}
    >
      {props.rows.map((row) => {
        const value =
          row.kind === 'model' ? row.choice.value : tieredRowTargetValue(row, props.currentTier)
        return (
          <DropdownMenuRadioItem key={value} value={value} disabled={props.disabled}>
            <ChoiceBody
              label={
                row.kind === 'model' ? nativeChatSessionChoiceLabel(row.choice) : row.baseLabel
              }
              description={row.kind === 'model' ? row.choice.description : undefined}
            />
          </DropdownMenuRadioItem>
        )
      })}
    </DropdownMenuRadioGroup>
  )
}

export function ModelTierPicker(props: {
  model: SessionOptionDescriptor
  row: TieredRow
  currentValue: string
  pending: boolean
  queued: boolean
  disabledReason: string | null
  dispatched: boolean
  setValue: (value: string) => void
}): React.JSX.Element {
  const current = props.row.tiers.find((tier) => tier.value === props.currentValue)
  const title = translate('components.native-chat.composer.effort', 'Effort')
  return (
    <DropdownMenu>
      <PickerTrigger
        label={current ? tierChoiceLabel(current) : title}
        tooltipLabel={title}
        disabled={props.pending}
        disabledReason={props.disabledReason}
        dispatched={props.dispatched}
        queued={props.queued}
      />
      <DropdownMenuContent align="start" side="top" collisionPadding={8} className="w-60">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-label={title}
          value={props.currentValue}
          onValueChange={props.setValue}
        >
          {props.row.tiers.map((tier) => (
            <DropdownMenuRadioItem
              key={tier.value}
              value={tier.value}
              disabled={!props.model.settable || props.pending}
            >
              <ChoiceBody label={tierChoiceLabel(tier)} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
