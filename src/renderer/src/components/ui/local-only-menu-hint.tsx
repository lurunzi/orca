import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { UnavailableEntryMenuHint } from '@/components/unavailable-entry'

/** Trailing reason on a menu item disabled because its target lives on another host. */
export function LocalOnlyMenuHint(): React.JSX.Element {
  const t = useTranslate()
  return (
    <UnavailableEntryMenuHint>
      {t('auto.components.sidebar.WorktreeOpenInMenu.localOnly', 'Local only')}
    </UnavailableEntryMenuHint>
  )
}
