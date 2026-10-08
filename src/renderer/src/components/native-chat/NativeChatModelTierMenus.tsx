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
  findTieredRow,
  type ModelPickerRow,
  type ModelTierChoice
} from './native-chat-model-tier-groups'
import { nativeChatSessionChoiceLabel } from './native-chat-session-option-labels'

type TieredRow = Extract<ModelPickerRow, { kind: 'tiered' }>

function tierChoiceLabel(tier: ModelTierChoice): string {
  return nativeChatSessionChoiceLabel({ value: tier.tier, label: tier.tierLabel })
}

export function ModelTierMenuRows(props: {
  usageLabel?: (value: string, label: string) => string | undefined
  rows: readonly ModelPickerRow[]
  currentValue: string | undefined
  preferredTier?: string
  disabled: boolean
  setValue: (value: string) => void
}): React.JSX.Element {
  const currentTier =
    props.preferredTier ??
    findTieredRow(props.rows, props.currentValue)?.tiers.find(
      (tier) => tier.value === props.currentValue
    )?.tier
  return (
    <DropdownMenuRadioGroup
      aria-label={translate('components.native-chat.composer.model', 'Model')}
      value={props.currentValue}
      onValueChange={props.setValue}
    >
      {props.rows.map((row) => {
        if (row.kind === 'tiered') {
          const choice =
            row.tiers.find((tier) => tier.value === props.currentValue) ??
            row.tiers.find((tier) => tier.tier === currentTier) ??
            row.tiers[0]
          if (!choice) {
            return null
          }
          return (
            <DropdownMenuRadioItem
              key={row.tiers[0]?.value}
              value={choice.value}
              disabled={props.disabled}
            >
              <ChoiceBody
                label={row.baseLabel}
                description={[choice.description, props.usageLabel?.(choice.value, row.baseLabel)]
                  .filter(Boolean)
                  .join(' ? ')}
              />
            </DropdownMenuRadioItem>
          )
        }
        return (
          <DropdownMenuRadioItem
            key={row.choice.value}
            value={row.choice.value}
            disabled={props.disabled}
          >
            <ChoiceBody
              label={nativeChatSessionChoiceLabel(row.choice)}
              description={[
                row.choice.description,
                props.usageLabel?.(row.choice.value, row.choice.label)
              ]
                .filter(Boolean)
                .join(' ? ')}
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
