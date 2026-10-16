import { Inbox } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { NativeChatInboxPanel } from './NativeChatInboxPanel'
import type { NativeChatInbox } from './use-native-chat-inbox'

/** Header button for the session's inbox, with how many entries wait on the user. */
export function NativeChatInboxButton({
  inbox,
  agentLabel
}: {
  inbox: NativeChatInbox
  agentLabel: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [openedAt, setOpenedAt] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const count = inbox.attentionCount
  const label =
    count > 0
      ? translate(
          'components.native-chat.inbox.triggerWaiting',
          'Inbox, {{count}} waiting on you',
          {
            count
          }
        )
      : inbox.findings.length === 1
        ? translate(
            'components.native-chat.inbox.triggerFindings_one',
            'Inbox, {{count}} finding',
            {
              count: 1
            }
          )
        : inbox.findings.length > 1
          ? translate(
              'components.native-chat.inbox.triggerFindings_other',
              'Inbox, {{count}} findings',
              { count: inbox.findings.length }
            )
          : translate('components.native-chat.inbox.title', 'Inbox')
  const changeOpen = (next: boolean): void => {
    setOpen(next)
    if (next) {
      setOpenedAt(Date.now())
      inbox.history.load()
    }
  }
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            {/* One element either way, so an open panel keeps its anchor as the count changes. */}
            <Button
              type="button"
              variant="ghost"
              size={count > 0 ? 'xs' : 'icon-xs'}
              aria-label={label}
              data-native-chat-inbox-count={count}
              className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              <Inbox className="size-3" />
              {count > 0 ? <span className="tabular-nums">{count}</span> : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={4}
        wheelScroll
        className="w-96"
        aria-label={translate('components.native-chat.inbox.title', 'Inbox')}
        // A list, not a form: focus the panel so Esc closes it and Tab reaches the actions.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          panelRef.current?.focus()
        }}
      >
        <div ref={panelRef} tabIndex={-1} className="outline-none">
          <NativeChatInboxPanel
            inbox={inbox}
            agentLabel={agentLabel}
            now={openedAt}
            onLeave={() => setOpen(false)}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
