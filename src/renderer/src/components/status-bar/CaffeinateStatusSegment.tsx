import { useEffect, useMemo, useState } from 'react'
import { Coffee } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store/index'
import { useAppStoreWithHostStatuses } from '@/store/slices/runtime-status/views/use-runtime-status-view'
import { isPairedWebClientWindow } from '@/app-shell/chrome/desktop-window-chrome'
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { runtimeHostConnectionStateForEntry } from '@/runtime/hosts/connections/runtime-host-connection-state'
import {
  getAgentAwakeLidNote,
  getAgentAwakeModeLabel,
  getAgentAwakeTitle
} from '../settings/agents/behavior/agent-awake-copy'
import {
  computerAwakeSettingsForMode,
  normalizeComputerAwakeMode,
  type ComputerAwakeStatus
} from '../../../../shared/app-lifecycle/computer-awake-mode'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host/execution-host'
import { getHostDisplayLabelOverrides } from '../../../../shared/execution-host/host-setting-overrides'
import { isListedRemoteServer } from '../../../../shared/remote-runtime/host-catalog/runtime-environments'
import { ComputerAwakeMenu } from './ComputerAwakeMenu'
import {
  nextComputerAwakeTargetId,
  readStoredComputerAwakeTargetId,
  storeComputerAwakeTargetId,
  type RemoteComputerAwake
} from './remote-computer-awake'
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from './composition/status-bar-context-menu-policy'
import { useRemoteComputerAwake } from './use-remote-computer-awake'

const INACTIVE_STATUS: ComputerAwakeStatus = {
  mode: 'off',
  active: false
}

function activityLabel(active: boolean, t: Translate = translate): string {
  return active
    ? t('auto.components.status.bar.CaffeinateStatusSegment.active', 'Active')
    : t('auto.components.status.bar.CaffeinateStatusSegment.inactive', 'Inactive')
}

function remoteUnavailableLabel(
  kind: Exclude<RemoteComputerAwake['kind'], 'ready'>,
  t: Translate = translate
): string {
  if (kind === 'loading') {
    return t('auto.components.status.bar.SshStatusSegment.runtime_checking', 'Checking')
  }
  return kind === 'unsupported'
    ? t('auto.components.status.bar.CaffeinateStatusSegment.notSupported', 'Not supported')
    : t('auto.components.status.bar.CaffeinateStatusSegment.unreachable', 'Unreachable')
}

export function CaffeinateStatusSegment(): React.JSX.Element | null {
  const t = useTranslate()
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const runtimeEnvironments = useAppStore((state) => state.runtimeEnvironments)
  // Joined ids keep the selection equal until a listed host starts or stops answering.
  const answeringHostIds = useAppStoreWithHostStatuses((state, statuses) =>
    state.runtimeEnvironments
      .filter(isListedRemoteServer)
      .filter((environment) => {
        const connection = runtimeHostConnectionStateForEntry(statuses.get(environment.id))
        return connection === 'connected' || connection === 'workspace-window-closed'
      })
      .map((environment) => environment.id)
      .join('\n')
  )
  const configuredMode = normalizeComputerAwakeMode(
    settings?.computerAwakeMode,
    settings?.keepComputerAwakeWhileAgentsRun
  )
  const [serviceStatus, setServiceStatus] = useState<ComputerAwakeStatus>(INACTIVE_STATUS)
  const [menuOpen, setMenuOpen] = useState(false)
  const [storedTargetId, setStoredTargetId] = useState(readStoredComputerAwakeTargetId)
  const webClient = isPairedWebClientWindow()

  useEffect(() => {
    let mounted = true
    const unsubscribe = window.api.agentAwake.onChanged((status) => {
      if (mounted) {
        setServiceStatus(status)
      }
    })
    void window.api.agentAwake
      .getStatus()
      .then((status) => {
        if (mounted) {
          setServiceStatus(status)
        }
      })
      .catch(() => {})
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const hostSettingOverrides = settings?.hostSettingOverrides
  // Only hosts that answer now: a mode cannot be read from or sent to one that is still connecting.
  const remoteHosts = useMemo(() => {
    const labelOverrides = getHostDisplayLabelOverrides({ hostSettingOverrides })
    const answering = new Set(answeringHostIds.split('\n'))
    return runtimeEnvironments
      .filter((environment) => isListedRemoteServer(environment) && answering.has(environment.id))
      .map((environment) => ({
        id: environment.id,
        label:
          labelOverrides.get(toRuntimeExecutionHostId(environment.id)) ||
          environment.name ||
          environment.id
      }))
  }, [answeringHostIds, hostSettingOverrides, runtimeEnvironments])
  // Why not cleared on disconnect: the choice returns with the host instead of moving here for good.
  const target = webClient ? null : (remoteHosts.find((host) => host.id === storedTargetId) ?? null)
  const { remote, setMode: setRemoteMode } = useRemoteComputerAwake(target?.id ?? null, menuOpen)

  if (webClient) {
    return null
  }

  const localMode = serviceStatus.mode === configuredMode ? serviceStatus.mode : configuredMode
  const localActive =
    serviceStatus.mode === configuredMode ? serviceStatus.active : configuredMode === 'on'
  const shown = target
    ? remote.kind === 'ready'
      ? remote.status
      : null
    : { mode: localMode, active: localActive }
  const active = shown?.active === true
  const title = getAgentAwakeTitle(t)
  const modeLabel = shown ? getAgentAwakeModeLabel(shown.mode, t) : '–'
  const statusText =
    shown || remote.kind === 'ready'
      ? `${modeLabel} · ${activityLabel(active, t)}`
      : remoteUnavailableLabel(remote.kind, t)
  const ariaLabel = target
    ? t(
        'auto.components.status.bar.CaffeinateStatusSegment.ariaLabelMachine',
        '{{title}}, {{machine}}, {{status}}',
        { title, machine: target.label, status: statusText }
      )
    : t('auto.components.status.bar.CaffeinateStatusSegment.ariaLabel', '{{title}}, {{status}}', {
        title,
        status: statusText
      })

  const setMode = (nextMode: string): void => {
    const mode = normalizeComputerAwakeMode(nextMode)
    if (!target) {
      void updateSettings(computerAwakeSettingsForMode(mode))
      return
    }
    void setRemoteMode(mode).then((accepted) => {
      if (!accepted) {
        toast.error(
          t(
            'auto.components.status.bar.CaffeinateStatusSegment.setFailed',
            "Couldn't change the setting on {{host}}.",
            { host: target.label }
          )
        )
      }
    })
  }

  const switchMachine = (): void => {
    const nextId = nextComputerAwakeTargetId(
      target?.id ?? null,
      remoteHosts.map((host) => host.id)
    )
    setStoredTargetId(nextId)
    storeComputerAwakeTargetId(nextId)
  }

  return (
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
              className="inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
              aria-label={ariaLabel}
            >
              <Coffee className={`size-3 ${active ? 'text-foreground' : ''}`} />
              <span className="text-[11px] font-medium">{modeLabel}</span>
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${
                  active ? 'bg-foreground' : 'bg-muted-foreground/40'
                }`}
              />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {/* The lid note describes this computer's platform, which says nothing about a remote host. */}
          {target ? ariaLabel : `${ariaLabel}. ${getAgentAwakeLidNote(undefined, t)}`}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
        side="top"
        align="end"
        sideOffset={8}
        className="w-64"
      >
        <ComputerAwakeMenu
          title={title}
          statusText={statusText}
          machine={
            remoteHosts.length > 0
              ? { remoteHostLabel: target?.label ?? null, onSwitch: switchMachine }
              : null
          }
          mode={shown?.mode ?? null}
          onModeChange={setMode}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
