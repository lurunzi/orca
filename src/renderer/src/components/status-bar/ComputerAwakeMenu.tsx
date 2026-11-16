import { ArrowRightLeft } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { getAgentAwakeModeLabel } from '../settings/agents/behavior/agent-awake-copy'
import type { ComputerAwakeMode } from '../../../../shared/app-lifecycle/computer-awake-mode'

/** The machine the menu controls, shown only once a remote host gives a choice. */
export type ComputerAwakeMenuMachine = {
  /** Null for this computer; a remote host's label otherwise. */
  remoteHostLabel: string | null
  onSwitch: () => void
}

export function ComputerAwakeMenu({
  title,
  statusText,
  machine,
  mode,
  onModeChange
}: {
  title: string
  statusText: string
  machine: ComputerAwakeMenuMachine | null
  /** Null while the chosen remote host has no mode to show; the modes are then not selectable. */
  mode: ComputerAwakeMode | null
  onModeChange: (mode: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const remoteHostLabel = machine?.remoteHostLabel ?? null
  const machineLabel =
    remoteHostLabel ??
    t('auto.components.status.bar.CaffeinateStatusSegment.thisComputer', 'This computer')

  return (
    <>
      {machine ? (
        <DropdownMenuItem
          aria-label={t(
            'auto.components.status.bar.CaffeinateStatusSegment.switchMachine',
            '{{title}}: {{machine}}, {{status}}. Switch machine',
            { title, machine: machineLabel, status: statusText }
          )}
          onSelect={(event) => {
            // Why: choosing the machine is the first of two steps; the modes below still need the menu.
            event.preventDefault()
            machine.onSwitch()
          }}
        >
          <ArrowRightLeft className="size-3.5" />
          <span className="min-w-0 truncate font-medium">{machineLabel}</span>
          <span className="ml-auto shrink-0 pl-1 text-2xs text-muted-foreground">{statusText}</span>
        </DropdownMenuItem>
      ) : (
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>{title}</span>
          <span className="ml-3 font-normal text-muted-foreground">{statusText}</span>
        </DropdownMenuLabel>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuRadioGroup value={mode ?? ''} onValueChange={onModeChange}>
        <DropdownMenuRadioItem value="on" disabled={mode === null}>
          <span className="flex flex-col">
            <span>{getAgentAwakeModeLabel('on', t)}</span>
            <span className="text-[11px] font-normal text-muted-foreground">
              {remoteHostLabel === null
                ? t(
                    'auto.components.status.bar.CaffeinateStatusSegment.onDescription',
                    'Keep this computer awake continuously'
                  )
                : t(
                    'auto.components.status.bar.CaffeinateStatusSegment.remoteOnDescription',
                    'Keep {{host}} awake continuously',
                    { host: remoteHostLabel }
                  )}
            </span>
          </span>
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="auto" disabled={mode === null}>
          <span className="flex flex-col">
            <span>{getAgentAwakeModeLabel('auto', t)}</span>
            <span className="text-[11px] font-normal text-muted-foreground">
              {remoteHostLabel === null
                ? t(
                    'auto.components.status.bar.CaffeinateStatusSegment.autoDescription',
                    'Stay awake while an agent is working'
                  )
                : t(
                    'auto.components.status.bar.CaffeinateStatusSegment.remoteAutoDescription',
                    'Keep {{host}} awake while an agent is working on it',
                    { host: remoteHostLabel }
                  )}
            </span>
          </span>
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="off" disabled={mode === null}>
          <span className="flex flex-col">
            <span>{getAgentAwakeModeLabel('off', t)}</span>
            <span className="text-[11px] font-normal text-muted-foreground">
              {t(
                'auto.components.status.bar.CaffeinateStatusSegment.offDescription',
                'Allow normal system sleep behavior'
              )}
            </span>
          </span>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </>
  )
}
