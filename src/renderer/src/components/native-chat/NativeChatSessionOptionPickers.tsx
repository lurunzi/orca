import { memo, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { SwitchIndicator } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { sortNativeChatSessionOptions } from '../../../../shared/native-chat-session-option-snapshot'
import {
  sessionOptionDispatchUnconfirmed,
  sessionOptionValueMarker,
  type SessionOptionDescriptor,
  type SessionOptionsSurface,
  type SessionOptionValue
} from '../../../../shared/native-chat-session-options'
import {
  nativeChatModelPillLabel,
  nativeChatOptionsPillLabel,
  nativeChatOptionsPillTitle,
  nativeChatSessionChoiceLabel,
  nativeChatSessionOptionDisabledReason,
  nativeChatSessionOptionLabel
} from './native-chat-session-option-labels'
import type { NativeChatOptionPickerRequest } from './native-chat-composer-types'
import { buildModelPickerRows, findTieredRow } from './native-chat-model-tier-groups'
import { ModelTierMenuRows, ModelTierPicker } from './NativeChatModelTierMenus'
import { ChoiceBody, PickerTrigger } from './NativeChatPickerTrigger'
import {
  useQueuedSessionOptions,
  withQueuedSessionOption
} from './native-chat-queued-session-options'

export type NativeChatSessionOptionPickersProps = {
  surface: SessionOptionsSurface | null
  snapshot: SessionOptionDescriptor[]
  isWorking: boolean
  pickerRequest?: NativeChatOptionPickerRequest | null
}

function DescriptorMenuRows(props: {
  descriptor: SessionOptionDescriptor
  pending: boolean
  /** Actions drive the TUI directly, so they cannot be queued for the next turn. */
  actionsBlocked: boolean
  setValue: (value: SessionOptionValue) => void
  invokeAction: () => void
}): React.JSX.Element {
  const { descriptor, pending, setValue, invokeAction } = props
  const actionDisabled = !descriptor.settable || pending || props.actionsBlocked
  // Why: flip-only without a baseline is an action — never claim On/Off.
  if (descriptor.action?.type === 'toggle-command') {
    return (
      <DropdownMenuItem disabled={actionDisabled} onSelect={() => invokeAction()}>
        {translate('components.native-chat.composer.toggleOption', 'Toggle {{value0}}', {
          value0: nativeChatSessionOptionLabel(descriptor).toLowerCase()
        })}
      </DropdownMenuItem>
    )
  }
  // Why: agent-picker opens the TUI; it is not a set of radio choices.
  if (descriptor.action?.type === 'agent-picker') {
    return (
      <DropdownMenuItem disabled={actionDisabled} onSelect={() => invokeAction()}>
        {translate(
          'components.native-chat.composer.chooseInAgentPicker',
          'Choose in agent picker…'
        )}
      </DropdownMenuItem>
    )
  }
  // Why one switch row and not On/Off: the option is binary, so a single control
  // carries it. The row owns the label, which is why the caller drops its header.
  // The value always renders; the marker is what keeps an unpicked one from
  // reading as confirmed, since the switch itself cannot say "nobody said".
  if (descriptor.kind.type === 'boolean') {
    const checked = descriptor.kind.currentValue
    const label = nativeChatSessionOptionLabel(descriptor)
    const marker = sessionOptionValueMarker(descriptor)
    const markerId = `session-option-marker-${descriptor.id}`
    return (
      <DropdownMenuItem
        role="switch"
        aria-checked={checked}
        // Named explicitly so the marker does not read as part of the control's
        // label, and described by it so assistive tech still gets the provenance —
        // hiding it would drop that distinction for screen readers alone.
        aria-label={label}
        {...(marker ? { 'aria-describedby': markerId } : {})}
        disabled={!descriptor.settable || pending}
        // Keep the menu open: the write is async and its result lands in this row.
        onSelect={(event) => {
          event.preventDefault()
          setValue(!checked)
        }}
        className="justify-between gap-2"
      >
        <span>{label}</span>
        <span className="flex items-center gap-1.5">
          {marker ? (
            <span id={markerId} className="text-[11px] text-muted-foreground">
              {marker === 'default'
                ? translate('components.native-chat.composer.valueIsDefault', 'Default')
                : translate('components.native-chat.composer.valueNotReported', 'Not reported')}
            </span>
          ) : null}
          <SwitchIndicator checked={checked} />
        </span>
      </DropdownMenuItem>
    )
  }
  return (
    <DropdownMenuRadioGroup
      aria-label={nativeChatSessionOptionLabel(descriptor)}
      value={descriptor.kind.currentValue}
      onValueChange={(value) => setValue(value)}
    >
      {descriptor.kind.choices.map((choice) => (
        <DropdownMenuRadioItem
          key={choice.value}
          value={choice.value}
          disabled={!descriptor.settable || pending}
        >
          <ChoiceBody
            label={nativeChatSessionChoiceLabel(choice)}
            description={choice.description}
          />
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

function runSurfaceCall(
  pendingKey: string,
  setPendingId: (id: string | null) => void,
  call: () => Promise<unknown>
): void {
  setPendingId(pendingKey)
  void call()
    .catch((error) => {
      toast.error(
        translate('components.native-chat.composer.optionUpdateFailed', 'Could not update option'),
        { description: error instanceof Error ? error.message : String(error) }
      )
    })
    .finally(() => setPendingId(null))
}

function NativeChatSessionOptionPickersInner({
  surface,
  snapshot,
  isWorking,
  pickerRequest
}: NativeChatSessionOptionPickersProps): React.JSX.Element | null {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const flush = useCallback(
    (entries: [string, SessionOptionValue][]) => {
      if (!surface || entries.length === 0) {
        return
      }
      runSurfaceCall(entries[0][0], setPendingId, () =>
        entries.reduce<Promise<unknown>>(
          (chain, [id, value]) => chain.then(() => surface.setOption(id, value)),
          Promise.resolve()
        )
      )
    },
    [surface]
  )
  const { queued, queue } = useQueuedSessionOptions({ isWorking, flush })
  const rawModel = snapshot.find((descriptor) => descriptor.category === 'model')
  const model = rawModel ? withQueuedSessionOption(rawModel, queued) : undefined
  const options = sortNativeChatSessionOptions(snapshot).map((descriptor) =>
    withQueuedSessionOption(descriptor, queued)
  )
  if (!surface || !model) {
    return null
  }
  const requestedModelSequence = pickerRequest?.id === model.id ? pickerRequest.sequence : null
  const requestedOptionsSequence = options.some((descriptor) => descriptor.id === pickerRequest?.id)
    ? (pickerRequest?.sequence ?? null)
    : null

  const setOption = (descriptor: SessionOptionDescriptor, value: SessionOptionValue): void => {
    if (isWorking) {
      queue(descriptor.id, value)
      return
    }
    runSurfaceCall(descriptor.id, setPendingId, () => surface.setOption(descriptor.id, value))
  }
  const invokeAction = (descriptor: SessionOptionDescriptor): void => {
    runSurfaceCall(descriptor.id, setPendingId, () => surface.invokeAction(descriptor.id))
  }

  const modelReason = nativeChatSessionOptionDisabledReason(model.disabledReason)
  const modelTooltip = translate('components.native-chat.composer.model', 'Model')
  const optionsTooltip = nativeChatOptionsPillTitle(options)
  const optionsReason =
    options.length > 0 && options.every((descriptor) => !descriptor.settable)
      ? nativeChatSessionOptionDisabledReason(options[0]?.disabledReason)
      : null
  const modelChoices = model.kind.type === 'select' && !model.action ? model.kind : null
  const modelRows = modelChoices ? buildModelPickerRows(modelChoices.choices) : []
  const currentModelId = model.valueSource === 'unknown' ? undefined : modelChoices?.currentValue
  const tieredRow = findTieredRow(modelRows, currentModelId)
  const currentTier = tieredRow?.tiers.find((tier) => tier.value === currentModelId)?.tier ?? null

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <DropdownMenu
        key={`model:${requestedModelSequence ?? 'idle'}`}
        defaultOpen={requestedModelSequence !== null}
      >
        <PickerTrigger
          label={tieredRow ? tieredRow.baseLabel : nativeChatModelPillLabel(model)}
          tooltipLabel={modelTooltip}
          disabled={pendingId !== null}
          disabledReason={modelReason}
          dispatched={sessionOptionDispatchUnconfirmed(model)}
          queued={queued.has(model.id)}
        />
        <DropdownMenuContent align="start" side="top" collisionPadding={8} className="w-64">
          {modelReason && !model.settable ? (
            <DropdownMenuLabel className="font-normal">{modelReason}</DropdownMenuLabel>
          ) : null}
          {modelChoices && modelRows.some((row) => row.kind === 'tiered') ? (
            <ModelTierMenuRows
              rows={modelRows}
              currentValue={modelChoices.currentValue}
              currentTier={currentTier}
              disabled={!model.settable || pendingId !== null}
              setValue={(value) => setOption(model, value)}
            />
          ) : (
            <DescriptorMenuRows
              descriptor={model}
              pending={pendingId !== null}
              actionsBlocked={isWorking}
              setValue={(value) => setOption(model, value)}
              invokeAction={() => invokeAction(model)}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {tieredRow && currentModelId ? (
        <ModelTierPicker
          model={model}
          row={tieredRow}
          currentValue={currentModelId}
          pending={pendingId !== null}
          queued={queued.has(model.id)}
          disabledReason={modelReason}
          dispatched={sessionOptionDispatchUnconfirmed(model)}
          setValue={(value) => setOption(model, value)}
        />
      ) : null}
      {options.length > 0 ? (
        <DropdownMenu
          key={`options:${requestedOptionsSequence ?? 'idle'}`}
          defaultOpen={requestedOptionsSequence !== null}
        >
          <PickerTrigger
            label={nativeChatOptionsPillLabel(options)}
            tooltipLabel={optionsTooltip}
            disabled={pendingId !== null}
            disabledReason={optionsReason}
            dispatched={options.some(sessionOptionDispatchUnconfirmed)}
            queued={options.some((descriptor) => queued.has(descriptor.id))}
          />
          <DropdownMenuContent align="start" side="top" collisionPadding={8} className="w-60">
            {options.map((descriptor, index) => {
              const reason = nativeChatSessionOptionDisabledReason(descriptor.disabledReason)
              return (
                <div key={descriptor.id}>
                  {index > 0 ? <DropdownMenuSeparator /> : null}
                  {descriptor.kind.type === 'boolean' && !descriptor.action ? null : (
                    <DropdownMenuLabel>
                      {nativeChatSessionOptionLabel(descriptor)}
                    </DropdownMenuLabel>
                  )}
                  {reason && !descriptor.settable ? (
                    <DropdownMenuLabel className="font-normal">{reason}</DropdownMenuLabel>
                  ) : null}
                  <DescriptorMenuRows
                    descriptor={descriptor}
                    pending={pendingId !== null}
                    actionsBlocked={isWorking}
                    setValue={(value) => setOption(descriptor, value)}
                    invokeAction={() => invokeAction(descriptor)}
                  />
                </div>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

export const NativeChatSessionOptionPickers = memo(NativeChatSessionOptionPickersInner)
