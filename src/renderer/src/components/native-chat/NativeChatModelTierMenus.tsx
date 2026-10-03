import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat-session-options'
import { ChoiceBody, PickerTrigger } from './NativeChatPickerTrigger'
import type { ModelPickerRow, ModelTierChoice } from './native-chat-model-tier-groups'
import { nativeChatSessionChoiceLabel } from './native-chat-session-option-labels'

type TieredRow = Extract<ModelPickerRow, { kind: 'tiered' }>

function tierChoiceLabel(tier: ModelTierChoice): string {
  return nativeChatSessionChoiceLabel({ value: tier.tier, label: tier.tierLabel })
}

/** Tiers remain selectable even before the agent reports its current model. */
export function ModelTierMenuRows(props: {
  rows: readonly ModelPickerRow[]
  currentValue: string | undefined
  disabled: boolean
  setValue: (value: string) => void
}): React.JSX.Element {
  return (
    <>
      {props.rows.map((row) => {
        if (row.kind === 'tiered') {
          return (
            <DropdownMenuSub key={row.baseLabel}>
              <DropdownMenuSubTrigger disabled={props.disabled}>
                {row.baseLabel}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  aria-label={row.baseLabel}
                  value={props.currentValue}
                  onValueChange={props.setValue}
                >
                  {row.tiers.map((tier) => (
                    <DropdownMenuRadioItem
                      key={tier.value}
                      value={tier.value}
                      disabled={props.disabled}
                    >
                      <ChoiceBody label={tierChoiceLabel(tier)} />
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )
        }
        return (
          <DropdownMenuRadioGroup
            key={row.choice.value}
            aria-label={translate('components.native-chat.composer.model', 'Model')}
            value={props.currentValue}
            onValueChange={props.setValue}
          >
            <DropdownMenuRadioItem value={row.choice.value} disabled={props.disabled}>
              <ChoiceBody
                label={nativeChatSessionChoiceLabel(row.choice)}
                description={row.choice.description}
              />
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        )
      })}
    </>
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
