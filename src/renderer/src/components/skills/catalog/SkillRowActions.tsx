import React from 'react'
import { ContextMenuItem } from '@/components/ui/context-menu'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UnavailableEntryLabel, UnavailableEntryMenuHint } from '@/components/unavailable-entry'

export type SkillRowAction = {
  key: string
  label: string
  icon: React.JSX.Element
  disabled?: boolean
  /** Explain disabled actions outside selection mode too, where the row badge is absent. */
  disabledReason?: string
  /** The skill's host cannot run this action; shown struck with this trailing reason. */
  unavailableReason?: string | null
  destructive?: boolean
  onSelect: () => void
}

function SkillRowActionContent({ action }: { action: SkillRowAction }): React.JSX.Element {
  return (
    <>
      {action.icon}
      <UnavailableEntryLabel unavailable={Boolean(action.unavailableReason)}>
        {action.label}
      </UnavailableEntryLabel>
      {action.unavailableReason ? (
        <UnavailableEntryMenuHint>{action.unavailableReason}</UnavailableEntryMenuHint>
      ) : null}
    </>
  )
}

/** Wrap disabled items to retain pointer events for their explanatory tooltip. */
function withReason(action: SkillRowAction, item: React.JSX.Element): React.JSX.Element {
  if (!action.disabled || !action.disabledReason) {
    return item
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="pointer-events-auto block">{item}</span>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={4}>
        {action.disabledReason}
      </TooltipContent>
    </Tooltip>
  )
}

export function SkillRowDropdownActions({
  actions
}: {
  actions: readonly SkillRowAction[]
}): React.JSX.Element {
  return (
    <>
      {actions.map((action) => (
        <React.Fragment key={action.key}>
          {withReason(
            action,
            <DropdownMenuItem
              disabled={action.disabled}
              variant={action.destructive ? 'destructive' : 'default'}
              onSelect={action.onSelect}
            >
              <SkillRowActionContent action={action} />
            </DropdownMenuItem>
          )}
        </React.Fragment>
      ))}
    </>
  )
}

export function SkillRowContextActions({
  actions
}: {
  actions: readonly SkillRowAction[]
}): React.JSX.Element {
  return (
    <>
      {actions.map((action) => (
        <React.Fragment key={action.key}>
          {withReason(
            action,
            <ContextMenuItem
              disabled={action.disabled}
              variant={action.destructive ? 'destructive' : 'default'}
              onSelect={action.onSelect}
            >
              <SkillRowActionContent action={action} />
            </ContextMenuItem>
          )}
        </React.Fragment>
      ))}
    </>
  )
}
