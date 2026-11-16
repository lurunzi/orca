import { defineFixture } from '../../component-fixtures/component-fixture'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ComputerAwakeMenu, type ComputerAwakeMenuMachine } from './ComputerAwakeMenu'
import type { ComputerAwakeMode } from '../../../../shared/computer-awake-mode'

function menu(
  statusText: string,
  mode: ComputerAwakeMode | null,
  machine: ComputerAwakeMenuMachine | null
): React.JSX.Element {
  return (
    <div className="flex h-[220px] items-end justify-end bg-background p-3">
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger>Awake</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-64">
          <ComputerAwakeMenu
            title="Keep computer awake"
            statusText={statusText}
            machine={machine}
            mode={mode}
            onModeChange={() => {}}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export const noRemoteHost = defineFixture({
  width: 320,
  render: () => menu('Agent · Inactive', 'auto', null)
})

export const thisComputer = defineFixture({
  width: 320,
  render: () => menu('Agent · Inactive', 'auto', { remoteHostLabel: null, onSwitch: () => {} })
})

export const remoteHost = defineFixture({
  width: 320,
  render: () => menu('On · Active', 'on', { remoteHostLabel: 'Mac mini', onSwitch: () => {} })
})

export const remoteHostLongName = defineFixture({
  width: 320,
  render: () =>
    menu('Agent · Inactive', 'auto', {
      remoteHostLabel: 'build-server-eu-west-02.internal',
      onSwitch: () => {}
    })
})

export const remoteHostNotSupported = defineFixture({
  width: 320,
  render: () => menu('Not supported', null, { remoteHostLabel: 'Mac mini', onSwitch: () => {} })
})
