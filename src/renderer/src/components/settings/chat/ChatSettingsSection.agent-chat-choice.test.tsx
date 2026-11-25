// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../../shared/orca-profiles/constants'
import type { GlobalSettings } from '../../../../../shared/settings/global-settings-types'
import { ChatSettingsSection } from './ChatSettingsSection'
import { TooltipProvider } from '../../ui/tooltip'
import { ActiveSettingsSectionProvider } from '../section-layout/SettingsSection'
import { getChatAppearanceSearchEntries } from '../appearance/chat/chat-appearance-search'
import { getChatNamingSearchEntry } from './chat-naming-search'
import { getChatInlineVisualsSearchEntry } from './chat-inline-visuals-search'
import { getChatBehaviorSearchEntries } from './chat-behavior-search'
import { getChatTurnActivitySearchEntries } from './chat-turn-activity-search'
import { AGENT_SESSION_QUEUED_MESSAGES_RUNTIME_CAPABILITY } from '../../../../../shared/agent-session/capabilities/agent-session-runtime-capabilities'
import { setLocalRuntimeCapabilitiesForTests } from '@/runtime/hosts/capabilities/local-runtime-capabilities'
import { i18n } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import { getChatLaunchSearchEntries } from './chat-launch-search'

vi.mock('@/lib/agent-session/launch/inventory/host-chat-program-acquisition', () => ({
  useChatProgramFacts: () => {}
}))

afterEach(async () => {
  cleanup()
  setLocalRuntimeCapabilitiesForTests(null)
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({ ensureNativeDetectedAgents: vi.fn(async () => []) })
  setLocalRuntimeCapabilitiesForTests([AGENT_SESSION_QUEUED_MESSAGES_RUNTIME_CAPABILITY])
})

function renderChat(
  showDesktopOnlySettings = true,
  hasUnsavedChatPromptChanges = false,
  overrides: Partial<GlobalSettings> = {}
) {
  const settings = { ...getDefaultSettings('/tmp'), ...overrides }
  useAppStore.setState({ settings })
  const updateSettings = vi.fn(async (updates: Partial<GlobalSettings>) => {
    const current = useAppStore.getState().settings
    if (current) {
      useAppStore.setState({ settings: { ...current, ...updates } })
    }
  })
  const element = (active = 'chat') => (
    <ActiveSettingsSectionProvider value={active}>
      <ChatSettingsSection
        settings={settings}
        updateSettings={updateSettings}
        writeSourceControlAiSettings={async () => {}}
        hostScope={{ target: { kind: 'local' }, available: true }}
        searchEntries={[
          ...(showDesktopOnlySettings ? getChatLaunchSearchEntries() : []),
          ...getChatAppearanceSearchEntries(),
          ...getChatTurnActivitySearchEntries(),
          ...getChatBehaviorSearchEntries(),
          ...(showDesktopOnlySettings
            ? [getChatNamingSearchEntry(), getChatInlineVisualsSearchEntry()]
            : [])
        ]}
        showDesktopOnlySettings={showDesktopOnlySettings}
        isMounted
        hasUnsavedChatPromptChanges={hasUnsavedChatPromptChanges}
      />
    </ActiveSettingsSectionProvider>
  )
  return { ...render(element(), { wrapper: TooltipProvider }), element, updateSettings }
}

it.each(['cursor', 'antigravity'] as const)(
  'offers and saves the %s transcript chat choice',
  async (agent) => {
    const { updateSettings } = renderChat(true, false, { agentDefaultSurface: 'terminal' })
    const label = agent === 'cursor' ? 'Cursor' : 'Antigravity'
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: `Open ${label} as` })).getByRole('radio', {
        name: 'Chat'
      })
    )
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
        nativeChatProviders: { [agent]: true }
      })
    )
  }
)
