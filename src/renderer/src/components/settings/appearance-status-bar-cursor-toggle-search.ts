import type { StatusBarToggleSearchEntry } from './status-bar-toggle-search-entry'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export function getCursorStatusBarToggleSearchEntry(): StatusBarToggleSearchEntry {
  return {
    id: 'cursor',
    title: translate('cursorUsage.usage', 'Cursor Usage'),
    description: translate(
      'cursorUsage.description',
      'Show Cursor monthly usage from the signed-in Cursor app or CLI.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.general.search.0cb3d94f00', 'cursor'),
      ...translateSearchKeyword('auto.components.settings.appearance.search.00a028f25f', 'usage')
    ],
    toggleDescription: translate(
      'cursorUsage.description',
      'Show Cursor monthly usage from the signed-in Cursor app or CLI.'
    )
  }
}
