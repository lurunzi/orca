import type { GlobalSettings } from '../../../../../../shared/global-settings-types'
import type { ClaudeAccountSwitchRunningSessions } from '../../../../../../shared/agent-accounts/claude/claude-account-switch-settings'
import { useTranslate } from '@/i18n/use-translate'
import { Label } from '../../../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select'
import { SearchableSetting } from '../../section-layout/SearchableSetting'
import { UnavailableEntryLabel, UnavailableEntryReason } from '../../../unavailable-entry'

const POLICIES: readonly ClaudeAccountSwitchRunningSessions[] = ['ask', 'restart', 'keep']

function isPolicy(value: string): value is ClaudeAccountSwitchRunningSessions {
  return POLICIES.some((policy) => policy === value)
}

export function ClaudeRunningSessionSwitchSetting({
  settings,
  updateSettings,
  unavailable = false
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  unavailable?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const title = t(
    'accounts.claude.switchSessions.settingTitle',
    'When you switch accounts while Claude is running in terminals'
  )
  const description = t(
    'accounts.claude.switchSessions.settingDescription',
    'Restarting continues each terminal conversation on the new account.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['claude', 'account', 'switch', 'restart', 'running', 'session']}
      className="flex items-center justify-between gap-4 py-3"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label>
          <UnavailableEntryLabel unavailable={unavailable}>{title}</UnavailableEntryLabel>
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
        {unavailable ? (
          <UnavailableEntryReason className="block">
            {t(
              'settings.remoteUnavailable.appliesToThisComputerOnly',
              'Applies to this computer only'
            )}
          </UnavailableEntryReason>
        ) : null}
      </div>
      <Select
        value={settings.claudeAccountSwitchRunningSessions ?? 'ask'}
        disabled={unavailable}
        onValueChange={(value) => {
          if (isPolicy(value)) {
            updateSettings({ claudeAccountSwitchRunningSessions: value })
          }
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-[140px]"
          aria-label={title}
          aria-disabled={unavailable || undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ask">
            {t('accounts.claude.switchSessions.settingAsk', 'Ask')}
          </SelectItem>
          <SelectItem value="restart">
            {t('accounts.claude.switchSessions.settingRestart', 'Always restart')}
          </SelectItem>
          <SelectItem value="keep">
            {t('accounts.claude.switchSessions.settingKeep', 'Never restart')}
          </SelectItem>
        </SelectContent>
      </Select>
    </SearchableSetting>
  )
}
