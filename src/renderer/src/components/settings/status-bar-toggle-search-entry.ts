import type { StatusBarItem } from '../../../../shared/ui-chrome-types'

export type StatusBarToggleSearchEntry = {
  id: StatusBarItem
  title: string
  description: string
  keywords: string[]
  toggleDescription: string
}
